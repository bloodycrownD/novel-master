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
 * session 的 modelId 在 agent pin 缺失时作为模型来源生效。
 */
describe("resolveDesktopSavedModelId session passthrough", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-saved-model-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("session modelId 在 agent 无 pin 时作为模型来源生效", async () => {
    const rt = await createDesktopNovelMasterRuntime();
    const prompts = layoutFromFormInput(createDefaultAgentEditorPrompts());
    // 无 pin 的 agent definition
    const definition = {
      name: "无 pin",
      runtime: { maxSteps: 20 },
      prompts,
    };
    // 新 core 下会话给终独立持有 agentId：create 需从 workspace 当前指针复制，
    // 这里先注册一个 agent 并设为 workspace 当前，保证 create 能落库。
    await rt.agentRegistry.upsert("any-agent", definition);
    await rt.state.setCurrentAgentId("any-agent");
    const project = await rt.projects.create("saved-model-proj");
    const session = await rt.sessions.create(project.id, "saved-model-s");

    // workspace 层已移除：agent 无 pin 且 session 无 modelId → 无模型可解析，拋 AgentRunError
    await assert.rejects(
      () => resolveDesktopSavedModelId(rt, definition, session.id),
      (err: unknown) => err instanceof Error,
    );

    // session modelId 覆盖 → 命中 sessionModelId（agentId 必填）
    await rt.sessions.updateSessionAgentConfig(session.id, {
      agentId: "any-agent",
      modelId: "session-saved-model",
    });
    const resolved = await resolveDesktopSavedModelId(rt, definition, session.id);
    assert.equal(resolved.savedModelId, "session-saved-model");
  });
});
