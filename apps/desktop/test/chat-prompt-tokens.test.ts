/**
 * Desktop chat-prompt-tokens T-T9：source===api ⇒ estimated:false, counterKind:api。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { sessionApiPromptTokenCache } from "@novel-master/core/provider";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleProvidersCreate } from "../src/main/ipc/handlers/providers.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  formatChatTokenStatsLabel,
  loadChatPromptTokenStats,
} from "../src/main/services/chat-prompt-tokens.service.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("chat-prompt-tokens.service", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

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

  it("T-T9: source===api ⇒ estimated:false && counterKind:api", async () => {
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

    const label = formatChatTokenStatsLabel(stats);
    assert.match(label, /· 自动$/);
    assert.doesNotMatch(label, /^~/);
  });

  it("T-T10: cache miss → 由 assistant usage 回填后重 resolve 走 source=api", async () => {
    // T-T9 在 cache 里留了 24_000，先确保这个用例从 miss 开始。
    sessionApiPromptTokenCache.clear(sessionId);

    const rt = await getDesktopRuntime();
    // 写一条带 promptTokens 的 assistant message——这是 agent 运行时落库的真实形态，
    // miss 时 backfillCacheFromMessages 会从后往前找到它。
    const PROMPT_TOKENS = 12_345;
    await rt.messages.append(
      sessionId,
      "assistant",
      {blocks: [{type: "text", text: "cache miss 回填用例"}]},
      {usage: {promptTokens: PROMPT_TOKENS, completionTokens: 1, totalTokens: PROMPT_TOKENS + 1}},
    );

    const stats = await loadChatPromptTokenStats(rt, {
      projectId,
      sessionId,
    });

    assert.equal(stats.tokenCount, PROMPT_TOKENS);
    assert.equal(stats.counterKind, "api");
    assert.equal(stats.estimated, false);

    // 顺便确认 cache 真被回填了——下一次 resolve 应直接命中。
    const cached = sessionApiPromptTokenCache.get(sessionId);
    assert.ok(cached, "回填后 cache 应有值");
    assert.equal(cached?.promptTokens, PROMPT_TOKENS);
  });
});
