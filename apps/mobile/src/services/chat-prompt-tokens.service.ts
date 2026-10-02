/**
 * Chat meta bar token labels (aligns with CLI `prompt render --tokens`).
 *
 * @module services/chat-prompt-tokens
 *
 * Boundary: per-model counter mode comes from
 * {@link resolveTokenCounterModeForModel} → `resolveCurrentPromptTokens`（API 优先，否则本地）。
 * {@link loadChatPromptTokenLabelResilient} falls back to visible-message heuristic
 * (`counterKind: "heuristic"`) when {@link buildSessionPromptInput} throws.
 *
 * stream-metrics-native ④：两处「拿不到模型 / 构建失败」的早退路径原本走
 * `runtime.tokenCounters.heuristic.countText`（`ceil(字符数 / 3.35)`）。该折算
 * 是**英文**口径，对中文正文系统性低估 82%~84%，而这两处恰恰是最需要保守
 * 估计的场景，故已改走 RN 驱动的 cl100k 真分词器（`counterKind` 仍是
 * `heuristic`、`estimated: true`——**近似**这件事不变，变的是读数本身）。
 */
import {resolveSavedModelId} from '@novel-master/core/agent';

import {messageBodyText} from '@novel-master/core/prompt';

import {
  PromptTokenResolveBailedError,
  resolvePromptTokensWithBackfill,
  resolveTokenCounterModeForModel,
  serializePromptLlmInput,
} from '@novel-master/core/provider';
import {countTextWithDefaultEncoding} from '@novel-master/tokenizer-driver-rn/encoding';
// 取消链路（tokenizer-native-cancel）：从桥的**子路径**导入（r3-P1-1）——包根
// 会把整个驱动 + js-tiktoken 拖进模块图，炸掉本套件的 core/provider 符号 mock。
import {
  cancelSessionNativeCounts,
  PromptCountCancelledError,
} from '@novel-master/tokenizer-driver-rn/android-native-bridge';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
// badge/label 走 common 入口取真身实现（token-source-label 单源；本套件的
// jest 会整体 mock `@novel-master/core/provider`，经 common 直取可让 T-TL4
// 对拍 core 真实现而非 mock 行为）。
import {
  formatContextUsageLabel,
  formatTokenSourceBadge,
} from '@novel-master/core/common';
import {
  buildSessionPromptInput,
  ChatPromptBuildBailedError,
  type SessionPromptScope,
} from './session-prompt-input.service';

/**
 * 兜底口径的 token 数：真 cl100k 计数优先，编码表建不起来才退回字符折算。
 *
 * 为什么不直接用 `runtime.tokenCounters.heuristic.countText`：那个 port 是
 * **同步**计数器且口径就是 `ceil(chars / 3.35)`，在中文下低估八成。RN 侧已经
 * 有可用的真分词器（且会话切换时已被 `primeStreamTokenModelHint` 空闲预热过
 * cl100k 兜底表），用它没有额外成本。
 */
function countFallbackTokens(
  runtime: MobileNovelMasterRuntime,
  serialized: string,
): number {
  const real = countTextWithDefaultEncoding(serialized);
  if (real != null) {
    return real;
  }
  return runtime.tokenCounters.heuristic.countText(serialized);
}

/**
 * 占用标签（源记号 + =/≈ 连接符 + pct + 占比）由 core 的
 * `formatTokenSourceBadge` + `formatContextUsageLabel` 统一给出，
 * 本文件不再自备一份映射（与 desktop main 的 buildTokenStats 同源同形）。
 */
function formatChatTokenLabel(
  result: {
    tokenCount: number;
    estimated: boolean;
    counterKind: string;
    source?: 'api' | 'local';
  },
  contextWindow: number | undefined,
): string {
  const badge = formatTokenSourceBadge(
    result.source,
    result.counterKind,
    result.estimated,
  );
  return formatContextUsageLabel(result.tokenCount, contextWindow, badge);
}

/**
 * 单发标签（完整口径：api 优先、miss 走家族计数器）。两阶段 UI 刷新用
 * {@link loadChatPromptTokenLabelResilient}；本函数留给单测与一次性取数场景。
 */
export async function loadChatPromptTokenLabel(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  return (await loadChatTokenLabelWithFlag(runtime, scope, false)).label;
}

/**
 * chip 中途弃权的两类哨兵错误统一判定：build 段（ChatPromptBuildBailedError）
 * 与 resolve 段（PromptTokenResolveBailedError，core 在整串级重活之前抛）。
 * 两处调用点（build / resolve）都必须用本判定收成空串哨兵——漏任何一处，
 * 弃权错误都会逃逸成外层 rejection 并回落 fallback（重算一遍，恰是要避免的）。
 */
function isChipBailError(error: unknown): boolean {
  return (
    error instanceof ChatPromptBuildBailedError ||
    error instanceof PromptTokenResolveBailedError
  );
}

/**
 * 取消判定（tokenizer-native-cancel）：原生计数被 {@link cancelPreciseUpgrade}
 * 撤掉时，桥层把 cancel reject 翻译成 `PromptCountCancelledError` 上抛。
 *
 * 收口口径与 bail **同款**（返回空串哨兵、无 warn），但语义不同：bail 是「用户
 * 已切走，这轮没人要」，取消是「这轮被主动作废」。两者都必须由 resolve 段的
 * catch 收口——漏出去的话 `runPreciseUpgrade` 的 catch 会打
 * `[chat] prompt token precise upgrade failed` 留痕（取消不是失败），空串哨兵
 * 同样让 hook 侧不写 meta。
 *
 * 只认 resolve 段：取消异常只可能从 resolve 链抛出（build 段不经过原生计数），
 * 故 build 段的 catch 一行不动。
 */
function isChipCancelError(error: unknown): boolean {
  return error instanceof PromptCountCancelledError;
}

/**
 * 估算首帧是否值得后台升级：只有「resolve 走了本地估算档」才升级（api 命中
 * 已精确、无模型/构建失败路径没有更好的档位可升）。
 */
async function loadChatTokenLabelWithFlag(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
  preferEstimate: boolean,
  shouldBail?: () => boolean,
): Promise<{label: string; upgradeWorthy: boolean}> {
  // chip 链分段计时（__DEV__ 诊断，logcat 过滤 [nm-chip]）：2026-09-30 停止
  // 失灵/压缩跳变两轮定位的关键读数（build=整串装配 / resolve=读口含 KKV）。
  const diagT0 = Date.now();
  let bundle;
  try {
    bundle = await buildSessionPromptInput(
      runtime,
      scope,
      undefined,
      shouldBail != null ? {shouldBail} : undefined,
    );
  } catch (error) {
    if (isChipBailError(error)) {
      // run 起步后中途弃权：label 空串是「保留旧标签」哨兵（hook 侧对空串
      // 不写 meta），不走 fallback——fallback 会再算一遍，恰是要避免的。
      if (__DEV__) {
        console.log('[nm-chip] bailed (run in flight)');
      }
      return {label: '', upgradeWorthy: false};
    }
    throw error;
  }
  const {definition, layout, ctx, rawMessages} = bundle;
  if (__DEV__) {
    console.log(
      `[nm-chip] build done +${Date.now() - diagT0}ms (preferEstimate=${preferEstimate})`,
    );
  }
  // 弃权检查点（build/resolve 关键边界，r3-chip-1）：build 的分段 bail 只管得到
  // build 段内部，最后一段 bail 到 resolve 派发之间还夹着 getSessionAgentConfig、
  // resolveSavedModelId、resolveTokenCounterModeForModel 三次 IO——run 起步的
  // 窗口正落在这里。命中即按空串哨兵收场，绝不放行到 resolve。
  if (shouldBail?.() === true) {
    if (__DEV__) {
      console.log('[nm-chip] bailed at build/resolve boundary');
    }
    return {label: '', upgradeWorthy: false};
  }
  const sessionConfig = await runtime.sessions.getSessionAgentConfig(
    scope.sessionId,
  );
  const savedModelId = resolveSavedModelId({
    agentModelId: definition.model,
    sessionModelId: sessionConfig.modelId,
  });
  if (!savedModelId) {
    // 已知残留（r3-chip-1 留痕，刻意不补 bail）：无模型早退分支的 serialize +
    // countFallbackTokens 整串级重活没有弃权点。理由——① 这一分支只统计可见
    // 消息正文、不做整串装配，量级比 resolve 段小一个数量级；② 无模型即无
    // 会话升级价值，丢掉这轮读数没有损失（下一轮刷新自然补上）。真要补也不难，
    // 但会让「无 bail 分支」这个例外从注释升格成需要长期维护的分支。
    const serialized = await serializePromptLlmInput(layout, ctx);
    const count = countFallbackTokens(runtime, serialized);
    return {
      label: formatChatTokenLabel(
        {tokenCount: count, estimated: true, counterKind: 'heuristic', source: 'local'},
        undefined,
      ),
      upgradeWorthy: false,
    };
  }
  const tokenizerOverride = await resolveTokenCounterModeForModel(
    runtime.providerModels,
    savedModelId,
  );
  // resolve 段（含 ~5.8s 级原生整串计数）同样要能中途弃权：core 在驱动调用前
  // 抛 PromptTokenResolveBailedError，这里收成空串哨兵——不包这段，弃权错误
  // 会逃到外层 catch 回落 fallback（重算一遍，恰是要避免的竞争）。
  let result;
  try {
    result = await resolvePromptTokensWithBackfill(
      scope.sessionId,
      rawMessages,
      {
        layout,
        ctx,
        savedModelId,
        registry: runtime.tokenCounters,
        tokenizerOverride,
        savedModels: {findById: id => runtime.providerModels.getSavedById(id)},
      },
      {
        sessionKkv: runtime.sessionKkv,
        ...(preferEstimate ? {preferEstimate: true} : {}),
        // r3-chip-1：resolve 段的弃权判据透传给 core 读口。core 在两处整串级
        // 重活之前（preferEstimate 序列化之前 / countPromptLlmInput 之前）检查它，
        // 命中抛 PromptTokenResolveBailedError——由本 catch 收成空串哨兵。
        // 不传时恒不弃权（core 缺省行为），故只在有判据时挂上这个键。
        ...(shouldBail != null ? {shouldBail} : {}),
      },
    );
  } catch (error) {
    if (isChipCancelError(error)) {
      // 取消收口（tokenizer-native-cancel）：在途原生计数被 cancelPreciseUpgrade
      // 撤掉。与 bail 同款收成空串哨兵——不重试、不回落 fallback（重算一遍等于
      // 取消白做），也不打 warn（取消不是失败）。
      if (__DEV__) {
        console.log('[nm-chip] cancelled during resolve');
      }
      return {label: '', upgradeWorthy: false};
    }
    if (isChipBailError(error)) {
      if (__DEV__) {
        console.log('[nm-chip] bailed during resolve (run in flight)');
      }
      return {label: '', upgradeWorthy: false};
    }
    throw error;
  }
  const contextWindow = await runtime.providerModels.getContextWindow(savedModelId);
  if (__DEV__) {
    console.log(
      `[nm-chip] resolve done +${Date.now() - diagT0}ms (preferEstimate=${preferEstimate})`,
    );
  }
  return {
    label: formatChatTokenLabel(result, contextWindow ?? undefined),
    upgradeWorthy: result.source === 'local' && result.estimated,
  };
}

/** 后台精确升级在途标记（按 sessionId）：避免事件风暴下堆叠重复整串计数。 */
const preciseUpgradeInflight = new Set<string>();

/**
 * 精确升级的启动延迟（2026-10-01 真机实锤「进大会话立刻侧滑退出被堵 2.2s」）：
 * 升级轮的整串装配 + 家族真分词器计数是秒级重活，与 JS 线程、原生模块队列、
 * 单条 SQLite 连接全部共享——首帧完成后立刻启动，恰好盖住「进会话就开始交互」
 * 的窗口（立刻浏览/立刻退出都被它堵）。延后启动把首屏黄金窗口让给交互；延迟
 * 到期时先查弃权判据（视图已切走/run 在途即不跑），停留超过本窗口的用户才
 * 真正触发这轮计数。
 *
 * 导出：测试的「还原默认值 / 推进假计时器」一律引用本常量——生产延迟一调，
 * 测试里的字面量会静默变成错值（cr2-B-2）。
 */
export const PRECISE_UPGRADE_START_DELAY_MS = 2500;
let preciseUpgradeStartDelayMs = PRECISE_UPGRADE_START_DELAY_MS;

/**
 * 测试口：置 0 = 立即启动（不经 setTimeout，微任务节奏即可断言升级轮，
 * 与延迟引入前的旧实现时序一致）——存量两阶段用例靠它保持零改动；
 * 新增「延迟启动」用例还原默认值后用假计时器推进。
 */
export function __setPreciseUpgradeDelayForTests(ms: number): void {
  preciseUpgradeStartDelayMs = ms;
}

/** 升级轮启动延迟计时器（按 sessionId）：由 {@link cancelPreciseUpgradeDelay} 收口。 */
const preciseUpgradeDelayTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 收口某会话**仍挂起**的精确升级延迟计时（换会话 / hook 卸载时调用）。
 *
 * ⚠ 语义硬约束（cr2-E-2）：只清 timer 是不够的，**必须连 inflight 与补跑槽一起
 * 清**。`runPreciseUpgrade` 的 finally 是 `preciseUpgradeInflight` /
 * `preciseUpgradeQueued` 的唯一清理点；延迟计时一旦被清，那轮 run 永不执行、
 * finally 永不跑，于是该会话的精确升级被**永久楔死在估算档**（后续所有升级请求
 * 只往补跑槽里排队、无人排空）——比原 bug 更隐蔽的回归。
 *
 * 「仅当计时器仍挂起才收口」：timer == null 说明这一轮已经起跑（延迟已到期、
 * 回调已把 timer 摘掉），此时动 inflight 会踩掉在途轮自己的 finally，交给它。
 * 会话 id 传 null/undefined 同理无事可做（该会话没有挂起计时）。
 */
export function cancelPreciseUpgradeDelay(
  sessionId: string | null | undefined,
): void {
  if (sessionId == null) {
    return;
  }
  const timer = preciseUpgradeDelayTimers.get(sessionId);
  if (timer == null) {
    // 已起跑：在途/补跑槽的生命周期归 runPreciseUpgrade 的 finally 管。
    return;
  }
  clearTimeout(timer);
  preciseUpgradeDelayTimers.delete(sessionId);
  preciseUpgradeInflight.delete(sessionId);
  preciseUpgradeQueued.delete(sessionId);
}

/**
 * 收口某会话**在途**的原生精确计数（换会话 / hook 卸载时与
 * {@link cancelPreciseUpgradeDelay} 并调，tokenizer-native-cancel）。
 *
 * 与 delay 收口的分工：delay 收口的是「还没起跑的延迟窗口」，本函数收口的是
 * 「已经过了桥、正在 Kotlin 队列里跑的整串计数」——那一轮秒级，R8 实锤侧滑退出
 * 会被它堵住。两者触发条件逐条等价，所以 hook 两处都并调。
 *
 * ⚠ 与 cr2-E-2 同族的另一条硬约束：本函数**只发指令、不碰生命周期**。在途轮的
 * inflight/补跑槽仍由 `runPreciseUpgrade` 的 finally 唯一清理——外部代摘会踩掉
 * 那轮自己的 finally，会话楔死估算档比不取消更糟。取消后该轮会带着
 * `PromptCountCancelledError` 收场（resolve 段 catch 收成空串哨兵），finally
 * 照常跑，补跑槽照常排空。
 *
 * 无在途轮 / 无会话 id / 原生未提供 cancelCount 时均为 no-op（桥内处理）。
 */
export function cancelPreciseUpgrade(
  sessionId: string | null | undefined,
): void {
  if (sessionId == null) {
    return;
  }
  if (__DEV__) {
    // R8 送达延迟观测的第一时间戳：cancel dispatch 与 native reject 落定之间
    // 的间距，就是取消链路的送达延迟（logcat 过滤 [nm-chip]）。
    console.log('[nm-chip] cancel dispatch ' + sessionId);
  }
  cancelSessionNativeCounts(sessionId);
}

/** 一次后台精确升级请求：轮次起步时所需的全部上下文。 */
type PreciseUpgradeRequest = {
  readonly runtime: MobileNovelMasterRuntime;
  readonly scope: SessionPromptScope;
  /** 发起它的首帧标签：精确标签与之一致时不必回调（读数没变）。 */
  readonly baselineLabel: string;
  readonly onPreciseUpgrade: (label: string) => void;
  /** 升级轮的中途弃权判定（run 起步即撤——升级永远不该与发送链竞争）。 */
  readonly shouldBail?: () => boolean;
};

/**
 * 升级补跑槽（按 sessionId，只留最新一次）：升级在途期间又来了「同样是估算
 * 档」的更新首帧时，把这一次的升级请求记下，等在途轮落定后立刻补跑。
 */
const preciseUpgradeQueued = new Map<string, PreciseUpgradeRequest>();

/**
 * 会话首帧刷新代数（升级回调新鲜度闸，cr-fix-spec-r2 s2/B-1）：每次
 * `loadChatPromptTokenLabelResilient` 首帧成功即 `gen++`。升级轮起步时记录
 * 当时代数，回调前比对——不等则丢弃：升级在途的 ~5.8s 里若发生切模型/新
 * 消息触发的刷新（必有新首帧、gen 必变），旧家族的精确标签（如 `glm =`）
 * 不得覆盖新首帧读数。
 */
const sessionRefreshGen = new Map<string, number>();

/**
 * 跑一轮后台精确升级；落定后若补跑槽里有排队的请求，按最新一次接着跑。
 *
 * 补跑这一层是必需的（2026-09-30 手动压缩实锤）：在途轮的精确结果会被新鲜度
 * 闸丢弃（gen 已推进），而新一轮又被在途标记挡掉——**两头一堵，chip 就停在
 * 估算档 `gpt ≈`**。手动压缩这类一次性动作恰好会连发两次刷新（transcript
 * 重载 + 显式刷新），之后往往没有「下一次触发」，所以旧注释里「被丢弃的升级
 * 由下次刷新自愈」并不成立。补跑仍保证同会话同时只有一轮在途（不堆叠并发
 * 计数），只是把它从「丢弃即终」改成「丢弃即重来」；一旦某一轮跑完，L1 里就
 * 有了该内容的精确条目，后续首帧直接命中精确档、不再排队，链条自然收敛。
 */
function startPreciseUpgrade(
  sessionId: string,
  request: PreciseUpgradeRequest,
): void {
  // 在途标记在延迟窗口起就算数：延迟期间再来的升级请求必须走补跑槽，
  // 否则去重失效、同会话两轮整串计数并发。
  //
  // 入口先收口上一轮的挂起计时（cr2-E-2）：本轮把它顶替了，旧 timer 的回调
  // 不会再跑，于是它的 finally 也不会来摘 inflight——不在这儿代摘，该会话的
  // inflight 标记会一直挂着，后续请求全部被挡进补跑槽、无人排空（楔死在估算
  // 档）。旧代码在这里读 `prev` 却写在 setTimeout 之后，清的是刚建好的本轮
  // 计时器（死代码，且真把本轮升级自己掐了）。
  const prevTimer = preciseUpgradeDelayTimers.get(sessionId);
  if (prevTimer != null) {
    clearTimeout(prevTimer);
    preciseUpgradeDelayTimers.delete(sessionId);
    preciseUpgradeInflight.delete(sessionId);
  }
  preciseUpgradeInflight.add(sessionId);
  if (preciseUpgradeStartDelayMs <= 0) {
    void runPreciseUpgrade(sessionId, request);
    return;
  }
  const timer = setTimeout(() => {
    preciseUpgradeDelayTimers.delete(sessionId);
    void runPreciseUpgrade(sessionId, request);
  }, preciseUpgradeStartDelayMs);
  preciseUpgradeDelayTimers.set(sessionId, timer);
}

/**
 * 升级轮本体（延迟到期后跑）：起步先查弃权（延迟窗口里视图已切走/run 已
 * 起步的话，这轮重活一行都不跑），其余语义与原实现一致（新鲜度闸 + 补跑槽）。
 */
async function runPreciseUpgrade(
  sessionId: string,
  request: PreciseUpgradeRequest,
): Promise<void> {
  // 代数在轮次起步时取（同步段）：首帧轮取到发起它的那一代，补跑轮取到最新一代。
  const gen = sessionRefreshGen.get(sessionId) ?? 0;
  try {
    if (request.shouldBail?.() === true) {
      if (__DEV__) {
        console.log('[nm-chip] precise upgrade bailed before start');
      }
      return;
    }
    const precise = await loadChatTokenLabelWithFlag(
      request.runtime,
      request.scope,
      false,
      request.shouldBail,
    );
    if (
      // 空串 = 中途弃权（run 已起步）：没有新读数可回调，也不能当失败留痕。
      precise.label !== '' &&
      sessionRefreshGen.get(sessionId) === gen &&
      precise.label !== request.baselineLabel
    ) {
      request.onPreciseUpgrade(precise.label);
    }
  } catch (error) {
    // 升级失败保持首帧估算标签；下次刷新/api 真值自愈。开发期留痕
    // （cr-fix-spec-r2 full/I-1）：静默失败会让 chip 永停估算档且无从排查。
    if (__DEV__) {
      console.warn('[chat] prompt token precise upgrade failed', error);
    }
  } finally {
    preciseUpgradeInflight.delete(sessionId);
    const queued = preciseUpgradeQueued.get(sessionId);
    if (queued != null) {
      preciseUpgradeQueued.delete(sessionId);
      startPreciseUpgrade(sessionId, queued);
    }
  }
}

/**
 * 两阶段标签（统计优先口径的 UI 面，2026-09-29 切模型慢复验定稿）：
 * 首帧 `preferEstimate` 即回（api 命中=精确；miss=CJK 感知廉价估算，`gpt ≈`）；
 * 首帧是估算档时后台跑一次完整 resolve（家族真分词器 + L1 整串缓存暖机），
 * 完成后经 `onPreciseUpgrade` 回调升级标签（`glm =` 等）。之后 api 真值到达
 * （下一次请求）自然接管。升级回调带新鲜度闸（见 {@link sessionRefreshGen}），
 * 在途期间的新首帧排进补跑槽（见 {@link startPreciseUpgrade}）——精确标签
 * 不会因为「恰好撞上另一次刷新」而永远不到。
 */
export async function loadChatPromptTokenLabelResilient(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
  onPreciseUpgrade?: (label: string) => void,
  options?: {
    readonly shouldBail?: () => boolean;
    /**
     * 精确升级轮的追加弃权判据（2026-10-01 侧滑退出被堵实锤）：升级是秒级
     * 后台重活，视图已切走（退出会话/切到别的会话）时继续跑纯属浪费，且它
     * 占着 JS 线程与原生模块队列，正是堵返回键的那只手。首帧轮不受此判据
     * 影响——首帧是 chip 显示的必要首拍且轻（估算档）。
     */
    readonly shouldBailPrecise?: () => boolean;
  },
): Promise<string> {
  let first: {label: string; upgradeWorthy: boolean};
  try {
    first = await loadChatTokenLabelWithFlag(
      runtime,
      scope,
      true,
      options?.shouldBail,
    );
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[chat] prompt token count failed, using message fallback',
        error,
      );
    }
    return loadChatPromptTokenLabelFallback(runtime, scope);
  }
  // 中途弃权（run 已起步）：返回空串哨兵——hook 侧对空串不写 meta（保留
  // 旧标签）、不推进代数（本轮没有产生新首帧，旧升级轮的新鲜度闸不受影响）。
  if (first.label === '') {
    return '';
  }
  const sessionId = scope.sessionId;
  const gen = (sessionRefreshGen.get(sessionId) ?? 0) + 1;
  sessionRefreshGen.set(sessionId, gen);
  // run 在途抑制（2026-09-30 真机实锤）：精确升级的整串装配 + 原生计数与发送链
  // 共享 JS 线程与单条 SQLite 连接——压缩/切模型后 API 基线失效的会话里，发送
  // 触发的升级轮曾把 40 条消息会话的前奏从亚秒拖到 11s（期间停止信号无观察点
  // 可兑现，用户连点 15 次无效）。run 在途时跳过升级（chip 保持估算档），run
  // 结束后的刷新（onSettled → transcript 变化）会补上——彼时无竞争。
  const runInFlight = runtime.abortRegistry.has(sessionId);
  if (first.upgradeWorthy && onPreciseUpgrade != null && !runInFlight) {
    const request: PreciseUpgradeRequest = {
      runtime,
      scope,
      baselineLabel: first.label,
      onPreciseUpgrade,
      // 升级轮中途弃权判 run 在途（不判 hasLabel——那是 hook 的展示层判据，
      // 升级无论有没有旧标签都不该与发送链竞争），叠加调用方的追加判据
      // （视图切走：升级不该与退出竞争，见 options.shouldBailPrecise 注释）。
      shouldBail: () =>
        runtime.abortRegistry.has(scope.sessionId) ||
        options?.shouldBailPrecise?.() === true,
    };
    if (preciseUpgradeInflight.has(sessionId)) {
      // 在途轮的去重语义不变（不并发堆叠整串计数）：本次首帧的升级请求排队，
      // 在途轮落定后补跑——否则它既不会被在途轮覆盖（gen 闸会丢），也没有
      // 任何一轮会跑，chip 就停在估算档（见 startPreciseUpgrade 注释）。
      preciseUpgradeQueued.set(sessionId, request);
    } else {
      startPreciseUpgrade(sessionId, request);
    }
  }
  return first.label;
}

/**
 * 压缩后的精确预热窗口（消跳变，2026-09-30 用户拍板「跳变也消掉」）的**在途计数**
 * （按 sessionId），非 Set 而 Map（r3-orc-1）。
 *
 * 口径：压缩改串 → L1 必 miss → 常规刷新首帧必是估算档（`gpt ≈`）、后台升级才到
 * `glm =`——用户看到标签跳变。压缩流程改为：先完整解析一轮（家族真分词器
 * + L1 落盘）暖缓存，期间 chip 冻结旧标签（refreshChatTokenLabel 见
 * {@link isChatTokenPreciseWarmInflight} 直接返回），暖完再补一次刷新——
 * 首帧命中 L1 精确档，无跳变。
 *
 * 为什么不用 Set：一条压缩链上有**两路**会动这个标志——编排层在 `runCompaction`
 * 之前 `begin`（冻结窗口，防止压缩过程中的转录事件把估算首帧刷出来），预热层在
 * 自己起步时又 +1 一次。Set 的 add/delete 不可数：预热先落定就会把整扇门打开，
 * 而此时压缩编排那一步还没收尾（`runCompactionWithTokenWarm` 的尾巴仍在跑），
 * 中途进来的 chip 刷新就会读到尚未暖好的 L1 —— 正是要消的跳变。
 *
 * **配对关系（写死，改动必须同时改对侧）**：
 * | 调用点 | +1 | -1 |
 * | --- | --- | --- |
 * | 编排层（`runCompactionWithTokenWarm`） | `beginChatTokenLabelFreeze`（runCompaction 之前） | `endChatTokenLabelFreeze`（等预热落定之后） |
 * | 预热层（`warmChatTokenLabelAfterCompaction`） | 函数入口 | 自己的 `finally` |
 *
 * 于是成功路径的计数是 `begin→1 / 预热起步→2 / 预热 finally→1 / 编排 end→0`：
 * 预热的 finally 只减 1，解冻要等两路都落定。失败/异常路径没有预热，计数
 * 走 `1→0`。任何一侧漏掉配对都会让计数卡住（永久冻结）或提前归零（跳变）。
 */
const preciseWarmInflight = new Map<string, number>();

/** 压缩预热是否在途（chip 刷新冻结用）：计数 > 0 即在途。 */
export function isChatTokenPreciseWarmInflight(sessionId: string): boolean {
  return (preciseWarmInflight.get(sessionId) ?? 0) > 0;
}

/**
 * 冻结窗口开启：压缩流程在 `runCompaction` **之前**调用。压缩过程本身的
 * 转录事件会触发 chip 刷新——窗口若在压缩结束后才开，估算首帧（gpt ≈）
 * 已经跳出来了（2026-09-30 真机实锤）。配对出口见 {@link endChatTokenLabelFreeze}
 * 与 {@link preciseWarmInflight} 的配对表。
 */
export function beginChatTokenLabelFreeze(sessionId: string): void {
  preciseWarmInflight.set(
    sessionId,
    (preciseWarmInflight.get(sessionId) ?? 0) + 1,
  );
}

/** 冻结计数 -1；归零即删键（解冻）。配对关系见 {@link preciseWarmInflight}。 */
export function endChatTokenLabelFreeze(sessionId: string): void {
  const next = (preciseWarmInflight.get(sessionId) ?? 0) - 1;
  if (next > 0) {
    preciseWarmInflight.set(sessionId, next);
    return;
  }
  preciseWarmInflight.delete(sessionId);
}

/**
 * 压缩后预热：完整解析一轮暖 L1。失败静默（预热失败仅回退为两阶段跳变，
 * 不得影响压缩流程本身）；无论成败都减自己的那一份计数。
 */
export async function warmChatTokenLabelAfterCompaction(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<void> {
  beginChatTokenLabelFreeze(scope.sessionId);
  try {
    await loadChatTokenLabelWithFlag(runtime, scope, false);
  } catch (error) {
    if (__DEV__) {
      console.warn('[chat] prompt token precise warm failed', error);
    }
  } finally {
    endChatTokenLabelFreeze(scope.sessionId);
  }
}

/** Message-only heuristic when full prompt build fails (still useful in meta bar). */
async function loadChatPromptTokenLabelFallback(
  runtime: MobileNovelMasterRuntime,
  scope: SessionPromptScope,
): Promise<string> {
  const all = await runtime.messages.listBySession(scope.sessionId);
  const visible = all.filter(m => !m.hidden);
  const serialized = visible
    .map(m => `${m.role}: ${messageBodyText(m)}`)
    .join('\n\n');
  const count = countFallbackTokens(runtime, serialized);

  const workspaceModelId = (await runtime.state.getCurrentModelId()) ?? '';
  let savedModelId: string | undefined;
  try {
    const {definition} = await buildSessionPromptInput(runtime, scope);
    const sessionConfig = await runtime.sessions.getSessionAgentConfig(
      scope.sessionId,
    );
    savedModelId = resolveSavedModelId({
      agentModelId: definition.model,
      sessionModelId: sessionConfig.modelId,
    });
  } catch {
    // 兜底显示用 workspace 当前模型（仅用于查 contextWindow，不参与 runtime 解析）。
    savedModelId = workspaceModelId || undefined;
  }

  let contextWindow: number | undefined;
  if (savedModelId) {
    try {
      const cw = await runtime.providerModels.getContextWindow(savedModelId);
      contextWindow = cw ?? undefined;
    } catch {
      contextWindow = undefined;
    }
  }

  return formatChatTokenLabel(
    {tokenCount: count, estimated: true, counterKind: 'heuristic', source: 'local'},
    contextWindow,
  );
}
