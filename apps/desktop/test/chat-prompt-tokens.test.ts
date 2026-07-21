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

    const session = await handleSessionsCreate({
      projectId,
      title: "token-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    const rt = await getDesktopRuntime();
    const saved = await rt.providerModels.save("openai", "gpt-4o");
    await rt.state.setCurrentModelId(saved.id);

    const agent = await handleAgentRegistryCreateBlank();
    assert.equal(agent.ok, true);
    if (!agent.ok) {
      return;
    }
    const setAgent = await handleAgentSetCurrent({ agentId: agent.data.agentId });
    assert.equal(setAgent.ok, true);
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
    assert.match(label, /· api$/);
    assert.doesNotMatch(label, /^~/);
  });
});
