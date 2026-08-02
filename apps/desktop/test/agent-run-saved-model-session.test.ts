import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from "@novel-master/core/config-forms/agent";
import { resolveDesktopSavedModelId } from "../src/main/services/agent-run.service.js";
import { createDesktopNovelMasterRuntime } from "../src/main/runtime/create-desktop-runtime.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/**
 * T-M1 desktop runtime 侧：resolveDesktopSavedModelId 透传 sessionId，
 * session bind 的 modelId 作为 agent pin 与 workspace 之间的中间层生效。
 */
describe("resolveDesktopSavedModelId session passthrough", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-saved-model-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("session bind modelId 介于 agent pin 与 workspace 之间", async () => {
    const rt = await createDesktopNovelMasterRuntime();
    const prompts = layoutFromFormInput(createDefaultAgentEditorPrompts());
    // 无 pin 的 agent definition
    const definition = {
      name: "无 pin",
      runtime: { maxSteps: 20 },
      prompts,
    };
    const project = await rt.projects.create("saved-model-proj");
    const session = await rt.sessions.create(project.id, "saved-model-s");

    // workspace 未设模型 + session follow → 无模型可解析，拋 AgentRunError（由 AgentRunResolveError 映射）
    await assert.rejects(
      () => resolveDesktopSavedModelId(rt, definition, session.id),
      (err: unknown) => err instanceof Error,
    );

    // session bind + modelId 覆盖 → 命中 sessionModelId
    await rt.sessions.updateSessionAgentConfig(session.id, {
      mode: "bind",
      agentId: "any-agent",
      modelId: "session-saved-model",
    });
    const resolved = await resolveDesktopSavedModelId(rt, definition, session.id);
    assert.equal(resolved.savedModelId, "session-saved-model");
  });
});
