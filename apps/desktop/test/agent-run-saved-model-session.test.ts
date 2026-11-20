import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from "../shared/config-forms/agent.js";
import { AgentRunService } from "../src/main/services/agent-run.service.js";
import { DesktopRuntimeFactory } from "../src/main/runtime/create-desktop-runtime.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/**
 * T-M1 desktop runtime 侧：resolveDesktopSavedModelIdOrThrow 透传 sessionId，
 * session 的 modelId 在 agent pin 缺失时作为模型来源生效；resolve 失败沿
 * `mapResolveError` 转 `AgentTurnError` 抛出（`OrThrow` 名字钉死的契约）。
 */
describe("resolveDesktopSavedModelIdOrThrow session passthrough", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-saved-model-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("session modelId 在 agent 无 pin 时作为模型来源生效", async () => {
    // 错误通道迁移七期后 runtime 工厂返回 Result，解包取实体。
    const rtR = await DesktopRuntimeFactory.create();
    if (!rtR.ok) throw rtR.error;
    const rt = rtR.value;
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
    // 测试环境会种子化 workspace 当前模型；负例前提是「agent 无 pin 且 session
    // 无 modelId」，而 create 会把 workspace modelId 复制进会话——先清空再建。
    await rt.state.resetCurrentModelId();
    // 错误通道迁移二期后 create 链走 Result，解包取实体。
    const projectCreated = await rt.projects.create("saved-model-proj");
    if (!projectCreated.ok) throw projectCreated.error;
    const project = projectCreated.value;
    const sessionCreated = await rt.sessions.create(
      project.id,
      "saved-model-s"
    );
    if (!sessionCreated.ok) throw sessionCreated.error;
    const session = sessionCreated.value;

    // workspace 层已移除：agent 无 pin 且 session 无 modelId → 无模型可解析，
    // resolveApplicationModelIdForRun 收 AGENT_MODEL_NOT_SET，经 mapResolveError
    // 转 AgentTurnError 抛出（抛出契约保留）。
    await assert.rejects(
      () => AgentRunService.resolveSavedModelIdOrThrow(rt, definition, session.id),
      (err: unknown) => err instanceof Error
    );

    // session modelId 覆盖 → 命中 sessionModelId（agentId 必填）
    const bound = await rt.sessions.updateSessionAgentConfig(session.id, {
      agentId: "any-agent",
      modelId: "session-saved-model",
    });
    if (!bound.ok) throw bound.error;
    const resolved = await AgentRunService.resolveSavedModelIdOrThrow(
      rt,
      definition,
      session.id
    );
    assert.equal(resolved.savedModelId, "session-saved-model");
  });
});
