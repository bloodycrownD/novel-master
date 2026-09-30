/**
 * Desktop chat-prompt-tokens T-T9：source===api ⇒ estimated:false, counterKind:api。
 *
 * stream-metrics-native ④：补一条「无模型早退」用例，钉住这条早退路径的读数已经是
 * 真 cl100k 计数（而不是 `ceil(chars / 3.35)` 字符折算）。
 *
 * CR fix-spec v3 `agile-2`：再补一条形态护栏，钉住兜底 registry 视图是用**显式转发**
 * 造的（原型方法 `forSavedModel` / `forVendorModel` 没被对象展开丢掉）。
 *
 * message-token-cache Step 4 / T-TC6：读口已加 300ms trailing debounce + 同参
 * 在途合并。扩展用例验证：rapid 双触发合并一次底层计算；并发 5 触发在途合并
 * 一次；trailing 语义（窗口内不执行、窗口过后必有最终一次、不吞任何一击）。
 *
 * token-source-label T-TL3：label 已由 main 的 buildTokenStats 经 core
 * formatTokenSourceBadge/formatContextUsageLabel 拼好随 stats 下发
 * （PromptChatTokenStatsResponse.label），deprecated 的
 * formatChatTokenStatsLabel/loadChatPromptTokenLabelResilient 链已删除；
 * renderer 纯渲染 stats.label（X1 清零 + 无 `~` 拼装残留）。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import type { WebContents } from "electron";
import {
  formatContextUsageLabel,
  formatTokenSourceBadge,
  promptWholeCache,
  sessionApiPromptTokenCache,
} from "@novel-master/core/provider";
import {
  IPC_CHANNELS,
  type PromptChatTokenUpdatedPayload,
} from "../shared/ipc-types.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import {
  handleAgentRegistryCreateBlank,
  handleAgentRegistryUpsert,
} from "../src/main/ipc/handlers/agent-registry.js";
import { handleMessagesAppend } from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleProvidersCreate } from "../src/main/ipc/handlers/providers.js";
import {
  handleSessionsCreate,
  handleSessionsSetModelOverride,
} from "../src/main/ipc/handlers/sessions.js";
import { setPromptChatTokenUpdatedForwardTarget } from "../src/main/ipc/forward-prompt-chat-token-updated.js";
import {
  chatPromptTokenDebounceExecCountForTests,
  holdReadWarmInflightForTests,
  loadChatPromptTokenStats,
  resetChatPromptTokenDebounceForTests,
  warmChatPromptTokenStatsAfterCompaction,
  withRealFallbackCounter,
} from "../src/main/services/chat-prompt-tokens.service.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("chat-prompt-tokens.service", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;
  /** workspace 当前模型 id：清掉会话覆盖后要原样还原，别把用例间的状态串起来。 */
  let savedModelId: string;
  /** `before` 里建的空白 agent id：T-T9c 要改它的系统提示词。 */
  let agentId: string;
  /** 第二相推送（main → renderer）的捕获：main.ts 的窗口解析器在测试里换成假 webContents。 */
  const pushed: PromptChatTokenUpdatedPayload[] = [];

  /** 等某会话的第二相推送（带超时，避免用例悬挂）。 */
  async function waitForPush(
    targetSessionId: string,
    timeoutMs = 4000,
  ): Promise<PromptChatTokenUpdatedPayload | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = pushed.find((p) => p.sessionId === targetSessionId);
      if (hit != null) {
        return hit;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  before(async () => {
    setPromptChatTokenUpdatedForwardTarget(
      () =>
        ({
          send: (channel: string, payload: unknown) => {
            if (channel === IPC_CHANNELS.PROMPT_CHAT_TOKEN_UPDATED) {
              pushed.push(payload as PromptChatTokenUpdatedPayload);
            }
          },
        }) as unknown as WebContents,
    );

    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-chat-tokens-"));

    const project = await handleProjectsCreate({ name: "token-stats" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下会话始终独立持有 agentId + modelId：create 会从 workspace 当前指针复制，
    // 这里先注册空白 agent、保存模型并都设为 workspace 当前，保证 create 能把两者落进 session 配置。
    const agent = await handleAgentRegistryCreateBlank();
    assert.equal(agent.ok, true);
    if (!agent.ok) {
      return;
    }
    const setAgent = await handleAgentSetCurrent({ agentId: agent.data.agentId });
    assert.equal(setAgent.ok, true);
    if (!setAgent.ok) {
      return;
    }
    agentId = agent.data.agentId;

    // 新 core 下 providerModels.save 会校验 provider 存在，先注册一个 openai 协议网关，
    // 再拿它返回的 providerId 去保存模型并设为 workspace 当前模型。
    const provider = await handleProvidersCreate({
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      displayName: "openai-test",
      apiKey: "sk-test",
    });
    assert.equal(provider.ok, true, provider.ok ? "" : provider.error.message);
    if (!provider.ok) {
      return;
    }

    const rt = await getDesktopRuntime();
    const saved = await rt.providerModels.save(
      provider.data.providerId,
      "gpt-4o",
    );
    await rt.state.setCurrentModelId(saved.id);
    savedModelId = saved.id;

    const session = await handleSessionsCreate({
      projectId,
      title: "token-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;
  });

  after(async () => {
    sessionApiPromptTokenCache.clearAll();
    resetChatPromptTokenDebounceForTests();
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-T9: source===api ⇒ estimated:false && counterKind:api（label 记号「远程 =」）", async () => {
    sessionApiPromptTokenCache.set(sessionId, {
      promptTokens: 24_000,
      updatedAt: Date.now(),
    });

    const rt = await getDesktopRuntime();
    const stats = await loadChatPromptTokenStats(rt, {
      projectId,
      sessionId,
    });

    assert.equal(stats.estimated, false);
    assert.equal(stats.counterKind, "api");
    assert.equal(stats.tokenCount, 24_000);
    assert.equal(stats.source, "api");

    // T-TL3 对拍：main 下发的 label 与 core 单源（badge + 拼装）重算完全一致。
    const expected = formatContextUsageLabel(
      stats.tokenCount,
      stats.contextWindow,
      formatTokenSourceBadge(stats.source, stats.counterKind, stats.estimated),
    );
    assert.equal(stats.label, expected);
    // api 真值 → 远程 =（无 ~，无「上次请求」旧后缀）。
    assert.match(stats.label, /^远程 = 24k \/ 128k \(\d+%\)$/);
  });

  it("T-T9b: 无 API 占用 ⇒ 两阶段：首帧估算（L1 冷）→ 后台暖机 → 主动推送精确读数", async () => {
    sessionApiPromptTokenCache.clearAll();
    // L1 清空：本用例要锁「首帧估算」态，前序用例/其它内容的整串条目
    // 虽按内容指纹寻址，清掉最稳（fresh 库无 KKV 种子，无跨重启残留）。
    promptWholeCache.clearForTests();
    pushed.length = 0;

    const rt = await getDesktopRuntime();
    // 首帧：preferEstimate 且 L1 冷 → 廉价估算即回（gpt ≈），服务侧安排
    // 后台暖机（家族真分词器 + L1 写入）。
    const first = await loadChatPromptTokenStats(rt, {
      projectId,
      sessionId,
    });
    assert.equal(first.source, "local");
    assert.equal(first.counterKind, "heuristic");
    assert.equal(first.estimated, true);
    assert.match(first.label, /^gpt ≈ \S+ \/ 128k \(\d+%\)$/);

    // 第二相必须**主动送达**（手动压缩/置位/回滚这类一次性动作之后没有
    // 「下一次触发」再让 renderer 自己去问，只暖 L1 会让 chip 停在估算档
    // `gpt ≈`——用户实报「手动压缩后分词器变成 gpt 兜底」）。推送恒为精确档。
    const pushedStats = await waitForPush(sessionId);
    assert.ok(pushedStats != null, "暖机完成后应推送精确读数（第二相投递）");
    assert.equal(pushedStats.stats.estimated, false);
    assert.equal(pushedStats.stats.source, "local");
    assert.equal(pushedStats.stats.counterKind, "tiktoken");
    assert.match(pushedStats.stats.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);

    // 且 L1 已暖：renderer 若自己再问一次（消息/step 事件触发的常规刷新）
    // 同样直读精确档，两条路径不打架。
    const second = await loadChatPromptTokenStats(rt, {
      projectId,
      sessionId,
    });
    assert.equal(second.counterKind, "tiktoken");
    assert.equal(second.estimated, false);
    assert.match(second.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);
    const expected = formatContextUsageLabel(
      second.tokenCount,
      second.contextWindow,
      formatTokenSourceBadge(second.source, second.counterKind, second.estimated),
    );
    assert.equal(second.label, expected);
  });

  /**
   * r3-cache-3：第二相投递**不许重跑 build**（build 调用 0 次），但「暖机期间
   * 模型已变」时仍要补读一次。
   *
   * 探针选 `runtime.messages.listBySession`：`buildSessionPromptInput` 每跑一次
   * 恰好取一次可见消息（与 T-DA1/T-CW2 同款口径），而「拉全部可见消息 + assemble
   * workplace + hydrate skill 全文 + 渲染整串提示词」正是要消灭的那趟秒级重活。
   * 改前投递前的补读会再跑一次 build（计数 2），改后只有首帧那一次（计数 1）。
   *
   * 用例各自新建会话（与 T-CW 同款理由）：L1 整串条目按内容指纹寻址、且精确档
   * 会落进该会话的 KKV，复用 `sessionId` 会让「首帧估算」这个前提直接不成立
   * （T-T9b 已经把那条精确档写进 KKV，`clearForTests` 只清内存不清盘）。
   */
  describe("T-T9b-x: 第二相投递不重跑 build（r3-cache-3）", () => {
    /** 新建一个带正文的冷会话（内容各不相同 → 内容指纹也各不相同）。 */
    async function createColdSession(
      name: string,
      text: string,
    ): Promise<string> {
      const project = await handleProjectsCreate({ name });
      assert.equal(project.ok, true);
      if (!project.ok) {
        throw new Error("创建项目失败");
      }
      const session = await handleSessionsCreate({
        projectId: project.data.id,
        title: name,
      });
      assert.equal(session.ok, true);
      if (!session.ok) {
        throw new Error("创建会话失败");
      }
      await handleMessagesAppend({
        sessionId: session.data.id,
        role: "user",
        text,
      });
      return session.data.id;
    }

    /** 数 build 次数的 runtime 探针（与 T-DA1/T-CW2 同款）。 */
    function probeBuildCount(rt: Awaited<ReturnType<typeof getDesktopRuntime>>): {
      rt: typeof rt;
      readonly listCalls: () => number;
    } {
      let listCalls = 0;
      const countingMessages = new Proxy(rt.messages, {
        get(target, prop, receiver) {
          if (prop === "listBySession") {
            return async (...args: unknown[]) => {
              listCalls += 1;
              return (
                target.listBySession as (...a: unknown[]) => Promise<unknown>
              )(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const probeRt = new Proxy(rt, {
        get(target, prop, receiver) {
          if (prop === "messages") {
            return countingMessages;
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof rt;
      return { rt: probeRt, listCalls: () => listCalls };
    }

    beforeEach(() => {
      sessionApiPromptTokenCache.clearAll();
      resetChatPromptTokenDebounceForTests();
      pushed.length = 0;
    });

    it("T-T9b2: 补推送路径不重跑 build（首帧之后 buildSessionPromptInput 调用 0 次）", async () => {
      const rt = await getDesktopRuntime();
      const coldSessionId = await createColdSession(
        "cache3-nobuild",
        "他把伞收了，窗外的雨顺着玻璃往下淌，街灯在水洼里碎成一片橙。".repeat(7),
      );
      const probe = probeBuildCount(rt);
      const scope = { projectId: projectId, sessionId: coldSessionId };

      // 冷会话 ⇒ 首帧走廉价估算档（gpt ≈），并顺带排一次后台暖机。
      const first = await loadChatPromptTokenStats(probe.rt, scope);
      assert.equal(first.estimated, true, "冷会话首帧应仍是估算档（前提）");
      assert.equal(probe.listCalls(), 1, "首帧恰好跑一次 build（前提）");

      // 暖机跑完 → 第二相投递：直接推手里那份精确档，**不再 build**。
      const pushedStats = await waitForPush(coldSessionId);
      assert.ok(pushedStats != null, "暖机完成后应推送精确读数（第二相投递）");
      assert.equal(pushedStats.stats.estimated, false);
      assert.equal(pushedStats.stats.source, "local");
      assert.equal(pushedStats.stats.counterKind, "tiktoken");
      assert.match(pushedStats.stats.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);
      assert.equal(
        probe.listCalls(),
        1,
        "补推送路径重跑了 build（buildSessionPromptInput 应只在首帧跑 1 次）",
      );

      // 反面对照：后续自己再问一口仍是精确档（说明「少跑的那趟」没把读数搞丢），
      // 而这一次读口自己那一趟 build 照跑 —— 探针确实在数。
      const second = await loadChatPromptTokenStats(probe.rt, scope);
      assert.equal(second.estimated, false);
      assert.equal(second.counterKind, "tiktoken");
      assert.equal(probe.listCalls(), 2, "后续这次读口应恰好再跑一次 build");
    });

    it("T-T9b3: 暖机期间换了模型 ⇒ 补读一次（不让旧模型的精确档闪进 UI）", async () => {
      const rt = await getDesktopRuntime();
      const coldSessionId = await createColdSession(
        "cache3-modelswitch",
        "雨还没停。屋里暖气烘着，玻璃上那层水雾被指尖抹开一条缝。".repeat(7),
      );

      // 第二个探针：卡住「模型是否已变」那一次判活读会话配置的轻查询。
      //
      // 卡 `sessions.getSessionAgentConfig` 而不是别的：判活是
      // 「先读会话配置、再读 agent 定义、比 savedModelId」，**要卡在读会话
      // 配置那一刻**——卡晚了就等于拿切换前的旧值去比，测不出东西。
      // 调用序：① build 的 resolveAgentForProject ② computeChatPromptTokenStats
      // 读 savedModelId ③ 投递判活。所以从第 3 次起卡。
      //
      // 真实时序下「暖机跑完」与「用户切模型」之间的窗口极窄，靠自然撞出来
      // 等于没有牙齿，所以把它撑开：卡住判活 → 切模型 → 放行。
      let configReads = 0;
      let releaseJudge!: () => void;
      const judgeGate = new Promise<void>((resolve) => {
        releaseJudge = resolve;
      });
      const gatedSessions = new Proxy(rt.sessions, {
        get(target, prop, receiver) {
          if (prop === "getSessionAgentConfig") {
            return async (...args: unknown[]) => {
              configReads += 1;
              if (configReads >= 3) {
                await judgeGate;
              }
              return (
                target.getSessionAgentConfig as (
                  ...a: unknown[]
                ) => Promise<unknown>
              )(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const probe = probeBuildCount(rt);
      const gatedRt = new Proxy(probe.rt, {
        get(target, prop, receiver) {
          if (prop === "sessions") {
            return gatedSessions;
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof rt;

      const scope = { projectId: projectId, sessionId: coldSessionId };
      const first = await loadChatPromptTokenStats(gatedRt, scope);
      assert.equal(first.estimated, true, "冷会话首帧应仍是估算档（前提）");
      assert.ok(
        configReads >= 2,
        "首帧读口应至少读过两次会话配置（前提）",
      );

      // 等判活那一次真的卡住（若投递路径改版导致判活不再读会话配置，
      // 这里会超时，随后「补读发生过」那条断言照样会红）。
      const judgeDeadline = Date.now() + 4000;
      while (configReads < 3 && Date.now() < judgeDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(configReads >= 3, "第二相投递的模型判活未发生（前提不成立）");

      // 此刻清掉会话级模型覆盖：解析链上 agent 也无 pin ⇒ 当下 savedModelId
      // 变空，与暖机用的那个比对不上 ⇒ 必须走补读，不能直接推旧模型的档。
      const cleared = await handleSessionsSetModelOverride({
        sessionId: coldSessionId,
        modelId: null,
      });
      assert.equal(cleared.ok, true);
      releaseJudge();

      // 补读发生 ⇒ build 又跑了一次（首帧 1 + 补读 1）。
      const readDeadline = Date.now() + 4000;
      while (probe.listCalls() < 2 && Date.now() < readDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(
        probe.listCalls(),
        2,
        "暖机期间换模型后必须补读一次（首帧 1 + 补读 1）",
      );
      // 补读落到「无模型早退」档（heuristic + estimated）⇒ 按闸如实不推，
      // chip 停在旧读数，不会被启发式档盖掉。
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(
        pushed.length,
        0,
        "补读只拿到估算档时不该推（否则会用 gpt ≈ 盖掉精确标签）",
      );
    });
  });

  it("T-T9c: 无模型早退 ⇒ 真 cl100k 计数，而非 ceil(chars/3.35) 折算", async () => {
    sessionApiPromptTokenCache.clearAll();

    const rt = await getDesktopRuntime();
    // 空白 agent 的系统提示词是空的，早退分支会数出 0——那样这条用例就什么也
    // 证不了。先给它塞一段中文正文（也就是最吃亏于字符折算的那类文本）。
    const chinese = "他把伞收了，窗外的雨顺着玻璃往下淌，街灯在水洼里碎成一片橙。".repeat(
      20,
    );

    // 先取同一 session 的**精确档**读数（gpt-4o → tiktoken 家族）作为参照：
    // 早退档与它编的是同一段序列化文本，差别只在「真分词器 vs 字符折算」。
    // 两阶段下首次调用是估算档（gpt ≈）并安排后台暖机——参照必须取暖机
    // 完成后的二次读（L1 命中精确档；cr-fix-spec-r2 s2/G-1），否则拿到的是
    // 估算值、「精确档参照」失真。
    const upserted = await handleAgentRegistryUpsert({
      agentId,
      definition: {
        name: "token-stats-agent",
        runtime: { maxSteps: 20 },
        prompts: { system: chinese, persist: [], dynamic: [] },
      },
    });
    assert.equal(upserted.ok, true);
    await loadChatPromptTokenStats(rt, {
      projectId,
      sessionId,
    });
    let precise: Awaited<ReturnType<typeof loadChatPromptTokenStats>> | null =
      null;
    for (let i = 0; i < 20 && precise == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const next = await loadChatPromptTokenStats(rt, {
        projectId,
        sessionId,
      });
      if (next.counterKind === "tiktoken") {
        precise = next;
      }
    }
    assert.ok(precise != null, "暖机后应命中 L1 精确档作为参照");

    // 清掉会话级模型覆盖 + agent 无 model pin ⇒ resolveSavedModelId 返回空
    // ⇒ 走「无模型早退」分支。
    const cleared = await handleSessionsSetModelOverride({
      sessionId,
      modelId: null,
    });
    assert.equal(cleared.ok, true);

    try {
      const stats = await loadChatPromptTokenStats(rt, {
        projectId,
        sessionId,
      });

      // 语义与 UI 文案不变：仍然是「本地计数 + heuristic 兜底档」→ 记号 gpt ≈。
      assert.equal(stats.source, "local");
      assert.equal(stats.counterKind, "heuristic");
      assert.equal(stats.estimated, true);
      assert.equal(stats.contextWindow, undefined);
      assert.match(stats.label, /^gpt ≈ \S+ tokens$/);
      assert.ok(stats.tokenCount > 0);

      // 读数本身已换成真分词器：同一段文本，真 cl100k 计数与精确档同量级（约 1:1）；
      // 字符折算对中文正文会压到 1/5 左右（cl100k 约 1.64 token/字符，即
      // ≈0.61 字符/token；折算用的 3.35 是英文口径），所以 2 倍这条线足以把两者
      // 分开——若有人把早退路径改回 `heuristic.countText`，本断言立刻红。
      assert.ok(
        stats.tokenCount > precise.tokenCount / 2,
        `早退读数 ${stats.tokenCount} 相对精确档 ${precise.tokenCount} 偏低，像是仍在字符折算`,
      );
    } finally {
      // 还原 agent 定义与会话模型覆盖，别把状态泄漏给其它用例。
      // 注意两点：① 不能拿 `get` 返回的 raw wire 直接回灌（那是带元信息的存储
      // 形态，upsert 会拒）；② `prompts.system` 要么不写、要么给非空串。
      const restoredAgent = await handleAgentRegistryUpsert({
        agentId,
        definition: {
          name: "token-stats-agent",
          runtime: { maxSteps: 20 },
          prompts: { persist: [], dynamic: [] },
        },
      });
      assert.equal(
        restoredAgent.ok,
        true,
        restoredAgent.ok ? "" : restoredAgent.error.message,
      );
      const restored = await handleSessionsSetModelOverride({
        sessionId,
        modelId: savedModelId,
      });
      assert.equal(restored.ok, true);
    }
  });

  it("T-T9d: 兜底 registry 的 forSavedModel / forVendorModel 可调用（形态护栏）", async () => {
    const rt = await getDesktopRuntime();
    const registry = withRealFallbackCounter(rt);

    // 形态护栏：`runtime.tokenCounters` 是 `DefaultTokenCounterRegistry` 的**类实例**，
    // `forSavedModel` / `forVendorModel` 挂在**原型**上、不是自有可枚举属性。曾经这里
    // 写的是「对象展开 runtime.tokenCounters 再覆盖 heuristic」，展开后这两个方法在
    // 运行期直接消失，而 TS 因 spread 类型取自接口 `TokenCounterRegistry` 而**零告警**。
    // 今天没炸只因 core 的 `countPromptLlmInputHeuristicOnly` 恰好只读 `heuristic`。
    assert.equal(typeof registry.forSavedModel, "function");
    assert.equal(typeof registry.forVendorModel, "function");

    // 不止「存在」，还要「调得动」：core 兜底一旦用上这两个方法，抛错就没有下一层兜底。
    const byVendor = registry.forVendorModel("gpt-4o");
    assert.equal(typeof byVendor.countText, "function");
    const bySaved = await registry.forSavedModel(savedModelId);
    assert.equal(typeof bySaved.countText, "function");

    // 显式转发不能把读数口径改回去：`heuristic` 必须仍是真 cl100k 适配器。
    assert.equal(registry.heuristic.kind, "heuristic");
    const chinese = "他把伞收了，窗外的雨顺着玻璃往下淌。";
    assert.ok(
      registry.heuristic.countText(chinese) > chinese.length / 3.35,
      "兜底 registry 的 heuristic 像是退回 ceil(chars/3.35) 字符折算了",
    );
  });

  it("T-TL3: renderer 纯渲染 stats.label——X1 清零、无 ~ 拼装残留、UI 渲染口径一致", async () => {
    const src = await readFile(
      new URL(
        "../renderer/features/chat/SessionDetailDrawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    // X1：renderer 不能直连 @novel-master/core（label 拼装已上移 main）。
    assert.equal(
      src.includes("@novel-master/core"),
      false,
      "SessionDetailDrawer 不应 import @novel-master/core（X1）",
    );
    // 旧「预估/~」体系清零：无 ~ 字面量、无本地拼装函数、无旧标签函数名。
    assert.equal(src.includes("~"), false, "SessionDetailDrawer 残留 ~ 拼装");
    assert.equal(
      src.includes("tokenCountLabel"),
      false,
      "本地拼装 tokenCountLabel 应已删除",
    );
    assert.equal(
      src.includes("formatTokenSourceLabel"),
      false,
      "旧 formatTokenSourceLabel 引用应已删除",
    );
    // UI 渲染口径：头部直接渲染 main 下发的 stats.label（渲染与下发一致）。
    assert.ok(
      src.includes("{tokenStats.label}"),
      "头部应直接渲染 stats.label",
    );
  });

  describe("T-TC6: 读口防抖（300ms trailing + 在途合并）", () => {
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    beforeEach(() => {
      sessionApiPromptTokenCache.clearAll();
      resetChatPromptTokenDebounceForTests();
    });

    it("rapid 双触发（<300ms 窗口内）合并为一次底层计算", async () => {
      const rt = await getDesktopRuntime();
      const scope = { projectId, sessionId };

      // 两个请求同帧连发（间隔远小于 300ms）：共享 trailing 窗口的同一次执行。
      const [a, b] = await Promise.all([
        loadChatPromptTokenStats(rt, scope),
        loadChatPromptTokenStats(rt, scope),
      ]);

      assert.equal(
        chatPromptTokenDebounceExecCountForTests(sessionId),
        1,
        "双触发应合并为一次底层计算",
      );
      // 合并的 caller 拿到同一份结果（读数一致，不出现两个口径）。
      assert.deepEqual(a, b);
      assert.equal(a.source, "local");
    });

    it("并发 5 触发在途合并为一次底层计算", async () => {
      const rt = await getDesktopRuntime();
      const scope = { projectId, sessionId };

      const results = await Promise.all(
        Array.from({ length: 5 }, () => loadChatPromptTokenStats(rt, scope)),
      );

      assert.equal(
        chatPromptTokenDebounceExecCountForTests(sessionId),
        1,
        "并发 5 触发应合并为一次底层计算",
      );
      for (const stats of results) {
        assert.deepEqual(stats, results[0]);
      }
    });

    it("trailing：窗口内不执行，窗口过后必有最终一次计算，且不吞任何一击", async () => {
      const rt = await getDesktopRuntime();
      const scope = { projectId, sessionId };

      // 单次触发：防抖是 trailing 而非 leading——窗口内（<300ms）不执行。
      const first = loadChatPromptTokenStats(rt, scope);
      await sleep(150);
      assert.equal(
        chatPromptTokenDebounceExecCountForTests(sessionId),
        0,
        "300ms 窗口内不应有底层计算（非 leading）",
      );
      // 窗口过后必须有最终一次计算（最终一致性：触发不悬挂）。
      const stats = await first;
      assert.equal(
        chatPromptTokenDebounceExecCountForTests(sessionId),
        1,
        "trailing 到期后必产生一次底层计算",
      );
      assert.equal(stats.source, "local");

      // 空闲后的再次触发不被吞：又产生一次计算（每一击最终都有计算）。
      await loadChatPromptTokenStats(rt, scope);
      assert.equal(
        chatPromptTokenDebounceExecCountForTests(sessionId),
        2,
        "第二次触发也必须产生一次底层计算",
      );
    });
  });

  /**
   * 手动压缩后的显式预热（`warmChatPromptTokenStatsAfterCompaction`）。
   *
   * 用独立的冷会话：L1 整串缓存跨会话按内容指纹寻址、且会从 session KKV 复种，
   * 复用前面用例暖过的会话会让「本函数有没有真跑完整口径」这条断言失去牙齿
   * （旧条目会直接命中，看起来像本函数干的）。
   */
  describe("T-CW: 压缩后显式预热（消除手动压缩的占用标签跳变）", () => {
    let warmProjectId: string;
    let warmSessionId: string;

    before(async () => {
      const project = await handleProjectsCreate({ name: "compaction-warm" });
      assert.equal(project.ok, true);
      if (!project.ok) {
        return;
      }
      warmProjectId = project.data.id;
      const session = await handleSessionsCreate({
        projectId: warmProjectId,
        title: "compaction-warm-session",
      });
      assert.equal(session.ok, true);
      if (!session.ok) {
        return;
      }
      warmSessionId = session.data.id;
      // 造点中文正文：空上下文会让「估算档 vs 精确档」的对比失去意义。
      await handleMessagesAppend({
        sessionId: warmSessionId,
        role: "user",
        text: "他把伞收了，窗外的雨顺着玻璃往下淌，街灯在水洼里碎成一片橙。".repeat(
          8,
        ),
      });
      await handleMessagesAppend({
        sessionId: warmSessionId,
        role: "assistant",
        text: "雨还没停。屋里暖气烘着，玻璃上那层水雾被指尖抹开一条缝。".repeat(
          8,
        ),
      });
    });

    beforeEach(() => {
      sessionApiPromptTokenCache.clearAll();
      promptWholeCache.clearForTests();
      resetChatPromptTokenDebounceForTests();
      pushed.length = 0;
    });

    it("T-CW1: 完整口径 resolve（不带 preferEstimate）+ 精确结果触发推送，首帧不再回落估算档", async () => {
      const rt = await getDesktopRuntime();
      const scope = { projectId: warmProjectId, sessionId: warmSessionId };

      // 前置状态由 beforeEach 铺好：L1 冷 + 无 API 基线，此刻任何读口调用都只会
      // 拿到 `gpt ≈`。
      //
      // ⚠️ 这里**不能**先自己读一口来「验证前提」：读口首帧会顺带排一次后台暖机，
      // 把 L1 写热 —— 那样本函数即便误传 `preferEstimate: true` 也会因 L1 命中而
      // 看起来正常，断言就废了牙齿。冷启动的前提只由 beforeEach 保证。
      await warmChatPromptTokenStatsAfterCompaction(rt, scope);

      // 精确档必须主动推给 renderer：压缩 IPC 返回后 renderer 那次刷新即便
      // 没赶上 L1，也还有这一推把 chip 覆盖回 `gpt =`。
      const pushedStats = await waitForPush(warmSessionId);
      assert.ok(
        pushedStats != null,
        "预热完成后应推送精确读数（误传 preferEstimate 不会写 L1、也就没有推送）",
      );
      assert.equal(pushedStats.stats.estimated, false);
      assert.equal(pushedStats.stats.source, "local");
      assert.equal(pushedStats.stats.counterKind, "tiktoken");
      assert.match(pushedStats.stats.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);

      // 关键断言：预热把 L1 写热了，于是「压缩后 renderer 立刻刷新的首帧」
      // 直读精确档。
      resetChatPromptTokenDebounceForTests();
      const firstFrame = await loadChatPromptTokenStats(rt, scope);
      assert.equal(
        firstFrame.estimated,
        false,
        "预热后首帧应直读 L1 精确档，不该回落 gpt ≈",
      );
      assert.equal(firstFrame.counterKind, "tiktoken");
      assert.match(firstFrame.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);
    });

    it("T-CW2: inflight 去重——在途未落定时再调直接返回，不重复排一轮", async () => {
      const rt = await getDesktopRuntime();
      const scope = { projectId: warmProjectId, sessionId: warmSessionId };

      // 把第一次预热卡在 buildSessionPromptInput 里（gate 未放行），此时
      // compactionWarmInflight 已置位但尚未落定。
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let listCalls = 0;
      const blockingMessages = new Proxy(rt.messages, {
        get(target, prop, receiver) {
          if (prop === "listBySession") {
            return async (...args: unknown[]) => {
              listCalls += 1;
              await gate;
              return (
                target.listBySession as (...a: unknown[]) => Promise<unknown>
              )(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const blockingRt = new Proxy(rt, {
        get(target, prop, receiver) {
          if (prop === "messages") {
            return blockingMessages;
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof rt;

      const first = warmChatPromptTokenStatsAfterCompaction(blockingRt, scope);
      // 等它真的进到取消息那一步，确保 inflight 标记已置位。
      // 必须带截止：若上一步没排上（例如 inflight 被前一个用例残留占用），
      // 裸 while 会把整个测试进程挂死，而不是干脆地红掉。
      const waitDeadline = Date.now() + 4000;
      while (listCalls === 0 && Date.now() < waitDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(
        listCalls > 0,
        "第一次预热未进入取消息阶段（inflight 可能被残留占用，本次去重断言无从检验）",
      );

      // 第二次调用：命中去重必须**一次 runtime 都不碰**（直接 return）。
      // 若去掉 inflight 判断，它会重新走一遍输入构建 —— get trap 立刻被触发。
      let touches = 0;
      const countingRt = new Proxy(rt, {
        get(target, prop, receiver) {
          touches += 1;
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof rt;
      await warmChatPromptTokenStatsAfterCompaction(countingRt, scope);
      assert.equal(
        touches,
        0,
        "在途暖机未落定前，重复调用应直接返回、不得再排一轮",
      );

      release();
      await first;
    });

    it("T-CW3: resolve 抛错时静默吞掉（永不 reject），且 finally 清空在途标记", async () => {
      const rt = await getDesktopRuntime();
      // 不存在的会话：buildSessionPromptInput → resolveAgentForProject 必抛。
      const badScope = { projectId: warmProjectId, sessionId: "no-such-session" };

      // 永不 reject：压缩已经成功了，暖机失败不能把成功态翻成失败态。
      await warmChatPromptTokenStatsAfterCompaction(rt, badScope);

      // 在途标记必须已被 finally 清掉：再调一次应当真的去跑（get trap 触发），
      // 而不是被去重挡下——否则这个 sessionId 会被永久「卡在途」。
      let touches = 0;
      const countingRt = new Proxy(rt, {
        get(target, prop, receiver) {
          touches += 1;
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof rt;
      await warmChatPromptTokenStatsAfterCompaction(countingRt, badScope);
      assert.ok(
        touches > 0,
        "失败后应清空 compactionWarmInflight，否则后续调用会被误判为在途而永不执行",
      );
    });

    /**
     * r3-cache-1：压缩暖机与读口暖机必须用**两个独立的 inflight Set**。
     *
     * 破坏不变式的具体形态：读口那一轮后台暖机还在途（readWarmInflight 已
     * 置位）时压缩暖机被共用去重挡下 → 预热根本没跑 → 压缩 IPC 立刻返回而
     * L1 仍冷 → renderer 压缩完成后的首帧回落 `gpt ≈`。读口暖机是 void 出去
     * 的、没有可 await 的句柄，所以「等它落定」这条路根本不存在，只能自己跑。
     */
    it("T-CW4: 读口暖机在途时压缩暖机仍完整跑一轮（两个 inflight Set 必须拆开）", async () => {
      const rt = await getDesktopRuntime();
      const scope = { projectId: warmProjectId, sessionId: warmSessionId };

      // 构造前提：读口那一轮后台暖机仍在途。真实时序下这个窗口只有几毫秒、
      // 靠自然撞出来等于没有牙齿，所以直接置位（钩子只动 readWarmInflight）。
      const releaseReadWarm = holdReadWarmInflightForTests(warmSessionId);
      let touches = 0;
      try {
        // 判据一：「完整口径 resolve 被调用」——压缩暖机真的动了 runtime。
        // 被去重挡下时它会直接 return，一次 get 都不会触发（与 T-CW2 同款探针）。
        const countingRt = new Proxy(rt, {
          get(target, prop, receiver) {
            touches += 1;
            return Reflect.get(target, prop, receiver);
          },
        }) as typeof rt;
        await warmChatPromptTokenStatsAfterCompaction(countingRt, scope);
      } finally {
        // 必须释放：占位期间读口自己排的暖机也会被去重挡下，泄漏会让后面的
        // 用例首帧永远停在估算档。
        releaseReadWarm();
      }
      assert.ok(
        touches > 0,
        "读口暖机在途不该挡下压缩暖机（两个 inflight Set 必须是分开的）",
      );

      // 判据二：完整口径跑完 ⇒ 精确档写入 L1 并主动推给 renderer。
      const pushedStats = await waitForPush(warmSessionId);
      assert.ok(
        pushedStats != null,
        "读口在途时压缩暖机仍应跑完整口径并推送精确读数",
      );
      assert.equal(pushedStats.stats.estimated, false);
      assert.equal(pushedStats.stats.source, "local");
      assert.equal(pushedStats.stats.counterKind, "tiktoken");
      assert.match(pushedStats.stats.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);

      // 判据三：首帧命中 L1（正是「预热要抢在首帧之前」的目的）。
      resetChatPromptTokenDebounceForTests();
      const firstFrame = await loadChatPromptTokenStats(rt, scope);
      assert.equal(
        firstFrame.estimated,
        false,
        "读口在途时压缩暖机仍应把 L1 写热，首帧不该回落 gpt ≈",
      );
      assert.equal(firstFrame.counterKind, "tiktoken");
      assert.match(firstFrame.label, /^gpt = \S+ \/ 128k \(\d+%\)$/);
    });
  });
});
