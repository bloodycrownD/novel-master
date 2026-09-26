/**
 * Desktop chat-prompt-tokens T-T9：source===api ⇒ estimated:false, counterKind:api。
 *
 * stream-metrics-native ④：补一条「无模型早退」用例，钉住这条早退路径的读数已经是
 * 真 cl100k 计数（而不是 `ceil(chars / 3.35)` 字符折算）。
 *
 * CR fix-spec v3 `agile-2`：再补一条形态护栏，钉住兜底 registry 视图是用**显式转发**
 * 造的（原型方法 `forSavedModel` / `forVendorModel` 没被对象展开丢掉）。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sessionApiPromptTokenCache } from "@novel-master/core/provider";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import {
  handleAgentRegistryCreateBlank,
  handleAgentRegistryUpsert,
} from "../src/main/ipc/handlers/agent-registry.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleProvidersCreate } from "../src/main/ipc/handlers/providers.js";
import {
  handleSessionsCreate,
  handleSessionsSetModelOverride,
} from "../src/main/ipc/handlers/sessions.js";
import {
  formatChatTokenStatsLabel,
  loadChatPromptTokenStats,
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

  before(async () => {
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
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-T9: source===api ⇒ estimated:false && counterKind:api（标签「上次请求」）", async () => {
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

    const label = formatChatTokenStatsLabel(stats);
    assert.match(label, /· 上次请求$/);
    assert.doesNotMatch(label, /^~/);
  });

  it("T-T9b: 无 API 占用 ⇒ source===local（标签「预估」）", async () => {
    sessionApiPromptTokenCache.clearAll();

    const rt = await getDesktopRuntime();
    const stats = await loadChatPromptTokenStats(rt, {
      projectId,
      sessionId,
    });

    assert.equal(stats.source, "local");
    // 本地档的 counterKind 取决于模型（tiktoken / claude / heuristic），
    // 但一定不是 api——两态标签只看 source，与分词器档位解耦。
    assert.notEqual(stats.counterKind, "api");
    const label = formatChatTokenStatsLabel(stats);
    assert.match(label, /· 预估$/);
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
    const upserted = await handleAgentRegistryUpsert({
      agentId,
      definition: {
        name: "token-stats-agent",
        runtime: { maxSteps: 20 },
        prompts: { system: chinese, persist: [], dynamic: [] },
      },
    });
    assert.equal(upserted.ok, true);
    const precise = await loadChatPromptTokenStats(rt, {
      projectId,
      sessionId,
    });

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

      // 语义与 UI 文案不变：仍然是「本地预估 + heuristic 档」。
      assert.equal(stats.source, "local");
      assert.equal(stats.counterKind, "heuristic");
      assert.equal(stats.estimated, true);
      assert.equal(stats.contextWindow, undefined);
      assert.match(formatChatTokenStatsLabel(stats), /^~/);
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
});
