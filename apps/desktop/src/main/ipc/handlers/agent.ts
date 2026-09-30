/**
 * Agent IPC handlers — run turn, resolve current, picker list/set.
 *
 * @module ipc/handlers/agent
 */
import { resolveSavedModelId } from "@novel-master/core/agent";

import {
  assertSavedModelUuid,
  savedModelDisplayName,
} from "@novel-master/core/provider";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  type AgentRunFailedPayload,
  type AgentRunFinishedPayload,
  type AgentRunStartedPayload,
  type SimpleEventBus,
} from "@novel-master/core/events";
import type {
  AgentAbortRequest,
  AgentListPickerResponse,
  AgentResolveCurrentResponse,
  AgentRunIsActiveRequest,
  AgentRunRequest,
  AgentSetCurrentRequest,
  IpcResult,
  ModelListPickerResponse,
  ModelSetCurrentRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../../runtime/types.js";
import {
  resolveCurrentAgentDefinition,
  resolveCurrentAgentId,
  resolveDesktopSavedModelId,
  runAgentTurn,
} from "../../services/agent-run.service.js";
import {
  decrementDesktopAgentActive,
  incrementDesktopAgentActive,
  isDesktopAgentActive,
} from "../../runtime/agent-activity.js";
import { desktopLogError } from "../../log/desktop-log.js";
import { formatIpcError } from "../format-ipc-error.js";
import { notifyUserMessageAppendedToRenderer } from "../forward-user-message-appended.js";

async function resolveModelLabel(
  rt: Awaited<ReturnType<typeof getDesktopRuntime>>,
  savedModelId: string,
): Promise<string> {
  const saved = await rt.providerModels.getSavedById(savedModelId);
  if (saved == null) {
    return savedModelId;
  }
  const provider = await rt.providers.get(saved.providerId);
  return savedModelDisplayName(saved, provider.displayName);
}

export async function handleAgentResolveCurrent(): Promise<
  IpcResult<AgentResolveCurrentResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const agentId = await resolveCurrentAgentId(rt);
    if (agentId == null) {
      return {
        ok: true,
        data: {
          agentId: undefined,
          agentName: "未配置 Agent",
          modelLabel: "—",
          hasDedicatedModel: false,
        },
      };
    }
    const { definition } = await resolveCurrentAgentDefinition(rt);
    const hasDedicatedModel =
      definition.model != null && definition.model !== "";
    // workspace 层已移除：workspace 级 agent 显示只取 agent pin，不再回退 workspace 模型。
    const savedModelId = resolveSavedModelId({
      agentModelId: definition.model,
    });
    let modelLabel = "未选择模型";
    if (savedModelId) {
      modelLabel = await resolveModelLabel(rt, savedModelId);
    }
    return {
      ok: true,
      data: {
        agentId,
        agentName: definition.name,
        modelLabel,
        hasDedicatedModel,
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentListPicker(): Promise<
  IpcResult<AgentListPickerResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const currentId = (await rt.state.getCurrentAgentId()) ?? undefined;
    const ids = await rt.agentRegistry.listAgentIds();
    const rows = [];
    for (const agentId of ids) {
      let label = agentId;
      try {
        const def = await rt.agentRegistry.get(agentId);
        if (def.mode === "subagent") continue;
        label = def.name?.trim() || agentId;
      } catch {
        /* keep id */
      }
      rows.push({ agentId, label });
    }
    return { ok: true, data: { rows, currentId } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentSetCurrent(
  req: AgentSetCurrentRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.state.setCurrentAgentId(req.agentId);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleModelListPicker(): Promise<
  IpcResult<ModelListPickerResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const currentId = (await rt.state.getCurrentModelId()) ?? undefined;
    const providers = await rt.providers.list();
    const rows = [];
    for (const provider of providers) {
      const saved = await rt.providerModels.savedList(provider.id);
      for (const model of saved) {
        const savedModelId = model.id;
        let label = savedModelDisplayName(model, provider.displayName);
        try {
          label = await resolveModelLabel(rt, savedModelId);
        } catch {
          /* keep derived label */
        }
        rows.push({ savedModelId, label });
      }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
    return { ok: true, data: { rows, currentId } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleModelSetCurrent(
  req: ModelSetCurrentRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const saved = await assertSavedModelUuid(
      req.savedModelId,
      rt.savedModelRepo,
    );
    await rt.state.setCurrentModelId(saved.id);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * activeRuns 条目。
 *
 * - `runId`：RUN_STARTED 到达后回填。前奏期（core 还在 backfill/装配）为 null。
 * - `terminalSeen`：已收到过「匹配本 entry 的」终态事件（FINISHED/FAILED）。
 */
type RunEntry = { runId: string | null; terminalSeen: boolean };

const activeRuns = new Map<string, RunEntry>();
/** abort 删除 activeRuns 后仍用于 FINISHED/FAILED 与 runId 匹配。 */
const sessionRunIds = new Map<string, string>();

let lifecycleSubscriptions: Array<{ unsubscribe: () => void }> = [];

/**
 * RUN_STARTED 时登记 runId（main 进程 eventBus 订阅，非 renderer 侧）。
 */
export function onCoreRunStarted({
  sessionId,
  runId,
}: AgentRunStartedPayload): void {
  const entry = activeRuns.get(sessionId);
  if (entry != null) {
    entry.runId = runId;
  }
  sessionRunIds.set(sessionId, runId);
}

function finishTrackedRun(sessionId: string, runId: string): void {
  const entry = activeRuns.get(sessionId);
  const trackedRunId = entry?.runId ?? sessionRunIds.get(sessionId);
  // r3-run-1 步骤 3：core 前奏期命中检查点 / 前奏抛错时发的终态事件 runId 是
  // 空串（''）——此刻 RUN_STARTED 还没到，entry.runId 仍是 null，
  // trackedRunId 落成 undefined（或上一轮遗留的真实 id），与 '' 不相等会被
  // 静默丢弃 → refcount 永久泄漏、后续全部 AGENT_BUSY。这里显式放行
  // 「runId 为空串且本 entry 尚无真实 runId」这一种前奏终态形态。
  //
  // 必须要求 entry != null：entry 已经不在表里说明 .finally（或外层 catch）
  // 已经做过一次清理与递减，此时再减就是双递减。
  const isPreludeTerminal = runId === "" && entry != null && entry.runId == null;
  if (trackedRunId !== runId && !isPreludeTerminal) {
    return;
  }
  if (entry != null) {
    entry.terminalSeen = true;
  }
  activeRuns.delete(sessionId);
  sessionRunIds.delete(sessionId);
  decrementDesktopAgentActive();
}

/** RUN_FINISHED 时清理 run 登记。 */
export function onCoreRunFinished({
  sessionId,
  projectId,
  runId,
}: AgentRunFinishedPayload): void {
  // 子 run 终态过滤（cr-func-w23 观察①）：runChildAgent 的子 run 终态 payload
  // 挂的是 childSessionId——desktop 从未在 activeRuns 登记过它，不过滤的话每个
  // 子代理 run 结束都会给子会话排一拍完整读口（build 整串重活，task 密集的
  // 会话平白多 N 趟）。采样必须在 finishTrackedRun **之前**：它一进来就把主
  // run 的 entry 删了，之后再采就恒 false 了。
  const wasTracked = activeRuns.has(sessionId);
  finishTrackedRun(sessionId, runId);
  if (wasTracked) {
    refreshChatTokenStatsAfterRun({ sessionId, projectId });
  }
}

/** RUN_FAILED 时清理 run 登记。 */
export function onCoreRunFailed({
  sessionId,
  projectId,
  runId,
}: AgentRunFailedPayload): void {
  const wasTracked = activeRuns.has(sessionId);
  finishTrackedRun(sessionId, runId);
  if (wasTracked) {
    refreshChatTokenStatsAfterRun({ sessionId, projectId });
  }
}

/**
 * 会话是否有在途 run（r3-dt-align 第 1 层的唯一判活源）。
 *
 * 判据写死 `rt.abortRegistry.has(sessionId)`，不用上面的 `activeRuns`：
 * - `activeRuns` 只在 desktop 自己的 `handleAgentRun` 入口登记，靠终态事件
 *   清理，是 **refcount 影子**，语义上「desktop 认为有 run 在跑」；
 * - `abortRegistry` 在 core `runAgentTurn` **函数入口**注册（受理即在途），
 *   由 core 自己的 finally 反注册，额外覆盖子 run，且不依赖终态事件到没到
 *   ——前奏期抛错/取消那些「refcount 已被回收、core 却还在跑」的窗口，它照样
 *   判真。`handleAgentRunIsActive` 早就是这条判据，本函数是它的同步版。
 *
 * 收 runtime 作参数而不是自己 `getDesktopRuntime()`：读口 service 手里已经有
 * 同一个 runtime（单测还会传 Proxy 探针），走参数才不会被绕开。
 */
export function isDesktopSessionRunInFlight(
  runtime: DesktopNovelMasterRuntime,
  sessionId: string,
): boolean {
  return runtime.abortRegistry.has(sessionId);
}

/**
 * 「run 结束后补跑一次 token 读口」的注入口（r3-dt-align 第 4 层）。
 *
 * 为什么是**注入口**而不是本模块直接 import 读口 service：import 方向写死
 * 单向 `chat-prompt-tokens.service → agent.ts`（第 1 层的判活源在本模块
 * 导出）。若这里再反向 import 读口 service，两个模块就成环——依赖环在
 * 增删导出时极难察觉（ESM 靠函数声明提升侥幸能跑），所以改成读口侧把自己
 * 的补跑实现注册进来，运行时序完全不变。
 */
type RunFinishedTokenStatsRefresh = (payload: {
  readonly sessionId: string;
  readonly projectId: string;
}) => void;

let runFinishedTokenStatsRefresh: RunFinishedTokenStatsRefresh | null = null;

/** 注册/注销 run 结束后的读口补跑（读口 service 在模块加载时注册自己）。 */
export function setRunFinishedTokenStatsRefresh(
  refresh: RunFinishedTokenStatsRefresh | null,
): void {
  runFinishedTokenStatsRefresh = refresh;
}

/**
 * 终态之后补跑一次读口（补跑槽的 desktop 等价物）。
 *
 * 放在 `finishTrackedRun(...)` **之后**、与终态处理同一条路径里，是 spec 的
 * 硬要求：另起一个 eventBus 订阅就变成「订阅顺序竞争」，不保证排在收口之后。
 *
 * 语义是 mobile 的 onSettled 补刷：run 期间 chip 一直被抑制（第 2 层），
 * 结束时若没有下一次触发，chip 就永远停在旧读数。这里补的那一拍经读口
 * **防抖入口**走（自带首帧估算 + 后台暖 + 精确档推送），于是和
 * SessionDetailDrawer 在 FINISHED 时自发的那次读口 IPC 合并成一次底层
 * 计算，不会双跑重活。
 *
 * 已知边界（留痕）：① 抽屉那次自发 reload 不在抑制范围内（run 已结束，多
 * 一次读口而已，且走防抖合并）；② stale 终态（runId 与 entry 不匹配、
 * finishTrackedRun 早退）也会补一拍——被防抖合并吃掉，不影响正确性。
 */
function refreshChatTokenStatsAfterRun(payload: {
  readonly sessionId: string;
  readonly projectId: string;
}): void {
  if (runFinishedTokenStatsRefresh == null) {
    return;
  }
  try {
    runFinishedTokenStatsRefresh(payload);
  } catch (err) {
    // 补拍失败绝不能影响终态收口（refcount / activeRuns 已在上游处理完）。
    desktopLogError("agent/run token stats refresh failed", {
      sessionId: payload.sessionId,
      err:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : String(err),
    });
  }
}

function detachAgentRunLifecycleListeners(): void {
  for (const sub of lifecycleSubscriptions) {
    sub.unsubscribe();
  }
  lifecycleSubscriptions = [];
}

/**
 * 订阅 core run 生命周期事件，与 handleAgentRun 同模块维护 activeRuns / agentActive。
 * 返回 cleanup 供 rebootstrap / quit。
 */
export function attachAgentRunLifecycleListeners(
  eventBus: SimpleEventBus,
): () => void {
  detachAgentRunLifecycleListeners();

  lifecycleSubscriptions = [
    eventBus.subscribe(EVENT_AGENT_RUN_STARTED, onCoreRunStarted),
    eventBus.subscribe(EVENT_AGENT_RUN_FINISHED, onCoreRunFinished),
    eventBus.subscribe(EVENT_AGENT_RUN_FAILED, (payload: unknown) => {
      onCoreRunFailed(payload as AgentRunFailedPayload);
    }),
  ];

  return detachAgentRunLifecycleListeners;
}

export async function handleAgentAbort(
  req: AgentAbortRequest,
): Promise<IpcResult<void>> {
  await abortAgentRun(req.sessionId);
  return { ok: true, data: undefined };
}

/**
 * 查询某 session 是否有 in-flight run——转调 rt.abortRegistry.has(sessionId)。
 * renderer 的 readOnly 子面板用它判断 stale，避免在 run 进行中渲染可交互 UI。
 */
export async function handleAgentRunIsActive(
  req: AgentRunIsActiveRequest,
): Promise<IpcResult<boolean>> {
  const rt = await getDesktopRuntime();
  return { ok: true, data: rt.abortRegistry.has(req.sessionId) };
}

/**
 * 测试专用：按 handleAgentRun → RUN_STARTED 的真实登记形态放进一条 tracked
 * run（entry 带 runId + sessionRunIds + refcount），让终态事件能走完
 * finishTrackedRun 的完整 runId 比对与递减。子 run 终态过滤（onCoreRunFinished
 * 的 wasTracked 闸）之后，单测想触发补推就必须先把 run「登记」进来——直接调
 * onCoreRunFinished 而不登记，事件会被当子 run 终态过滤掉。生产代码不得调用。
 */
export function registerTrackedRunForTests(
  sessionId: string,
  runId: string,
): void {
  activeRuns.set(sessionId, { runId, terminalSeen: false });
  sessionRunIds.set(sessionId, runId);
  incrementDesktopAgentActive();
}

export async function handleAgentRun(
  req: AgentRunRequest,
): Promise<IpcResult<{ started: boolean }>> {
  if (isDesktopAgentActive()) {
    return { ok: false, error: { code: "AGENT_BUSY", message: "Agent 正在运行" } };
  }

  try {
    const rt = await getDesktopRuntime();
    await resolveDesktopSavedModelId(
      rt,
      (await resolveCurrentAgentDefinition(rt)).definition,
      req.sessionId,
    );
    const { sessionId } = req;
    // Phase 3 Step 24：不再自建 AbortController / 不再传 signal。
    // core runAgentTurn 内部自建 internalController 注册到 rt.abortRegistry，
    // 停止按钮经 ipcAgentAbort → rt.abortRegistry.abort(sessionId) 中断。
    // activeRuns 退化为 refcount 影子——只跟 RUN_STARTED/FINISHED/FAILED 与
    // runId 比对 + finishTrackedRun 的 decrementDesktopAgentActive()。
    activeRuns.set(sessionId, { runId: null, terminalSeen: false });
    incrementDesktopAgentActive();

    void runAgentTurn(
      rt,
      { projectId: req.projectId, sessionId },
      req.userContent,
      {
        stream: req.stream !== false,
        allowResumeWithoutInput: req.allowResumeWithoutInput,
        attachments: req.attachments,
        annotateDrafts: req.annotateDrafts,
        onUserMessageAppended: () => {
          notifyUserMessageAppendedToRenderer({ sessionId });
        },
      },
    )
      .catch((err) => {
        desktopLogError("agent/run IPC background task failed", {
          sessionId,
          projectId: req.projectId,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      })
      .finally(() => {
        // Phase 3 Step 24(d)：refcount 单一归属——只由 finishTrackedRun 递减。
        // 这里仅做房子——清掉没收到任何匹配终态的早退 entry，避免 activeRuns 泄漏。
        //
        // 两条不变式（r3-run-2 步骤 2，注释写死别删）：
        //
        // ① **不双递减依赖事件总线同步分发。** core 的 eventBus.publish 是同步
        //    调用订阅方（SimpleEventBus 无 microtask 合批），finishTrackedRun
        //    在 bus 回调里同步 delete + decrement。因此 promise 走到 .finally
        //    时，正常路径的 entry 必然已被删掉（get 返回 undefined）→ 直接
        //    early return；下面的手工清理只覆盖「终态事件压根没来」的形态。
        //    若哪天总线改异步分发，这里的 early return 会失效 → 双递减，
        //    属架构变更，须同步改这两处（E3-C1 已判定不修）。
        //
        // ② **terminalSeen 不是废字段。** 它兜的是「entry 还在、但收到的那条
        //    终态事件 runId 与 entry 不匹配」这一类 stale 终态：finishTrackedRun
        //    匹配失败提前 return（不删 entry、不置位），此时 entry.runId 已被
        //    RUN_STARTED 回填成非 null——原先的 `entry.runId != null → return`
        //    判据会在这里放行并手工清理，但那条终态其实是上一轮 run 的迟到
        //    事件，真正的终态还没到，删掉就把在途 run 的登记弄丢了。改成
        //    terminalSeen 后，只有「确实已处理过本 entry 的终态」才早退。
        const entry = activeRuns.get(sessionId);
        if (entry == null || entry.terminalSeen) {
          return;
        }
        // 无匹配终态事件的早退（T23 / r3-run-1 前奏收口）：finishTrackedRun
        // 不会触发，手动清 map。
        // C-orch-1：早退分支必须同步递减 refcount，否则 incrementDesktopAgentActive()
        // 的增量永不回落，isDesktopAgentActive() 永久 true，后续 run 全部 AGENT_BUSY。
        // 不会双递减：正常路径 entry 已 deleted（见不变式①），或 terminalSeen 已置位。
        activeRuns.delete(sessionId);
        sessionRunIds.delete(sessionId);
        decrementDesktopAgentActive();
      });

    return { ok: true, data: { started: true } };
  } catch (err) {
    activeRuns.delete(req.sessionId);
    sessionRunIds.delete(req.sessionId);
    decrementDesktopAgentActive();
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 中断指定 sessionId 的当前 run——Phase 3 Step 24(a)。
 *
 * 改调 core registry（rt.abortRegistry.abort），不再依赖 activeRuns 里的
 * controller。refcount 递减交给 RUN_FINISHED/FAILED 的 finishTrackedRun。
 */
export async function abortAgentRun(sessionId: string): Promise<void> {
  const rt = await getDesktopRuntime();
  rt.abortRegistry.abort(sessionId);
  // activeRuns 的清理交给 finally / finishTrackedRun；这里只负责中断信号。
}

/**
 * 测试专用内省：暴露 run 追踪 map 的当前大小，用于断言早退兜底无泄漏。
 * 仅在单测中引用，生产代码不应依赖。
 */
export function __testRunTrackingState(): {
  activeRunsCount: number;
  sessionRunIdsCount: number;
} {
  return {
    activeRunsCount: activeRuns.size,
    sessionRunIdsCount: sessionRunIds.size,
  };
}
