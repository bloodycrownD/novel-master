import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from "@novel-master/core/config-forms/agent";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import {
  handleSessionsCreate,
  handleSessionsGetAgentBinding,
  handleSessionsSetAgentBinding,
  handleSessionsSetModelOverride,
} from "../src/main/ipc/handlers/sessions.js";
import { handlePromptAgentMeta } from "../src/main/ipc/handlers/prompt.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/**
 * T-D1：SESSIONS_GET/SET_AGENT_BINDING handler 透传 rt.sessions.* 正确，
 *      PromptAgentMetaResponse 含 modelSource 新字段。
 * T-D2：handlePromptAgentMeta 消费 req.sessionId（session source 由 session 维度触发）。
 * T-M1 desktop：session source + modelSource 两档（agent-pin / session）。
 *
 * 注意：core 已移除 workspace 回退层——会话始终独立持有 agentId（必填），
 * 不再有 follow/bind mode 区分。SessionAgentConfig 形态为 { agentId, modelId? }。
 */
describe("sessions agent-binding IPC handlers + prompt meta", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-sessions-agent-binding-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-D1：getAgentBinding 默认携带 workspace agent；setAgentBinding round-trip 写入 / 回退 workspace", async () => {
    // 先触发 singleton 初始化（handler 内部调 getDesktopRuntime），再注册 agent + 设 workspace 指针。
    const project = await handleProjectsCreate({ name: "绑定测试" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const { getDesktopRuntime } = await import(
      "../src/main/runtime/desktop-runtime-singleton.js"
    );
    const rt = await getDesktopRuntime();
    const basePrompts = layoutFromFormInput(createDefaultAgentEditorPrompts());
    await rt.agentRegistry.upsert("agent-x", {
      name: "Agent X",
      runtime: { maxSteps: 20 },
      prompts: basePrompts,
    });
    // workspace 当前 agent 指向 agent-x，新建会话时会复制该指针落库。
    await rt.state.setCurrentAgentId("agent-x");

    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "s1",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    const sessionId = session.data.id;

    // 默认携带 workspace agent（agent_config_json 由 create 复制 workspace 指针）。
    const initial = await handleSessionsGetAgentBinding({ sessionId });
    assert.equal(initial.ok, true);
    if (initial.ok) {
      assert.equal(initial.data.agentId, "agent-x");
      assert.equal("mode" in initial.data, false);
    }

    // 写入新 agent
    await rt.agentRegistry.upsert("agent-y", {
      name: "Agent Y",
      runtime: { maxSteps: 20 },
      prompts: basePrompts,
    });
    const bound = await handleSessionsSetAgentBinding({
      sessionId,
      agentId: "agent-y",
    });
    assert.equal(bound.ok, true);
    if (bound.ok) {
      assert.equal(bound.data.agentId, "agent-y");
    }

    // 重新读回一致
    const reread = await handleSessionsGetAgentBinding({ sessionId });
    assert.equal(reread.ok, true);
    if (reread.ok) {
      assert.equal(reread.data.agentId, "agent-y");
    }

    // agentId=null → 同步到 workspace 当前 agent（仍是 agent-x）
    const unbound = await handleSessionsSetAgentBinding({
      sessionId,
      agentId: null,
    });
    assert.equal(unbound.ok, true);
    if (unbound.ok) {
      assert.equal(unbound.data.agentId, "agent-x");
    }
  });

  it("T-D1：setModelOverride 写 modelId；清除回 undefined", async () => {
    const project = await handleProjectsCreate({ name: "模型覆盖测试" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const { getDesktopRuntime } = await import(
      "../src/main/runtime/desktop-runtime-singleton.js"
    );
    const rt = await getDesktopRuntime();
    const basePrompts = layoutFromFormInput(createDefaultAgentEditorPrompts());
    await rt.agentRegistry.upsert("agent-y", {
      name: "Agent Y",
      runtime: { maxSteps: 20 },
      prompts: basePrompts,
    });
    await rt.state.setCurrentAgentId("agent-y");

    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "s2",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    const sessionId = session.data.id;

    // 写入模型覆盖（agentId 保持现状）
    const overridden = await handleSessionsSetModelOverride({
      sessionId,
      modelId: "model-override-1",
    });
    assert.equal(overridden.ok, true);
    if (overridden.ok) {
      assert.equal(overridden.data.agentId, "agent-y");
      assert.equal(overridden.data.modelId, "model-override-1");
    }

    // 清除覆盖（agentId 保持）
    const cleared = await handleSessionsSetModelOverride({
      sessionId,
      modelId: null,
    });
    assert.equal(cleared.ok, true);
    if (cleared.ok) {
      assert.equal(cleared.data.agentId, "agent-y");
      assert.equal(cleared.data.modelId, undefined);
    }
  });

  it("T-D2 + T-M1：handlePromptAgentMeta 消费 sessionId，session source 与 modelSource 两档正确", async () => {
    const project = await handleProjectsCreate({ name: "Meta 两档" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const { getDesktopRuntime } = await import(
      "../src/main/runtime/desktop-runtime-singleton.js"
    );
    const rt = await getDesktopRuntime();
    const basePrompts = layoutFromFormInput(createDefaultAgentEditorPrompts());
    await rt.agentRegistry.upsert("agent-plain", {
      name: "普通",
      runtime: { maxSteps: 20 },
      prompts: basePrompts,
    });
    await rt.agentRegistry.upsert("agent-pinned", {
      name: "带专属模型",
      runtime: { maxSteps: 20 },
      prompts: basePrompts,
      // definition.model 在 wire decode 时校验为 savedModel UUID（v4 变体，第 4 段以 8/9/a/b 开头）
      model: "aabbccdd-1111-1111-8111-111111111111",
    });
    await rt.state.setCurrentAgentId("agent-plain");

    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "meta-s",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    const projectId = project.data.id;
    const sessionId = session.data.id;

    // ① session + agent 无 pin + 无 modelId → modelSource = session
    await handleSessionsSetAgentBinding({ sessionId, agentId: "agent-plain" });
    await verifyBindingCommitted(sessionId, "agent-plain");
    const metaPlain = await handlePromptAgentMeta({ projectId, sessionId });
    assert.equal(metaPlain.ok, true);
    if (metaPlain.ok) {
      assert.equal(metaPlain.data.source, "session");
      assert.equal(metaPlain.data.agentId, "agent-plain");
      assert.equal(metaPlain.data.hasDedicatedModel, false);
      assert.equal(metaPlain.data.modelSource, "session");
    }

    // ② session + agent 无 pin + session modelId 覆盖 → modelSource 仍是 session
    //    （agent pin 才会切到 agent-pin；session modelId 不改变来源档位）
    await handleSessionsSetModelOverride({
      sessionId,
      modelId: "session-model-x",
    });
    await verifyBindingCommitted(sessionId, "agent-plain");
    const metaOverride = await handlePromptAgentMeta({ projectId, sessionId });
    assert.equal(metaOverride.ok, true);
    if (metaOverride.ok) {
      assert.equal(metaOverride.data.source, "session");
      assert.equal(metaOverride.data.hasDedicatedModel, false);
      assert.equal(metaOverride.data.modelSource, "session");
    }

    // ③ session + agent 带 pin → modelSource = agent-pin（pin 压制 session 覆盖）
    await handleSessionsSetAgentBinding({ sessionId, agentId: "agent-pinned" });
    await verifyBindingCommitted(sessionId, "agent-pinned");
    const metaPinned = await handlePromptAgentMeta({ projectId, sessionId });
    assert.equal(metaPinned.ok, true);
    if (metaPinned.ok) {
      assert.equal(metaPinned.data.source, "session");
      assert.equal(metaPinned.data.agentId, "agent-pinned");
      assert.equal(metaPinned.data.hasDedicatedModel, true);
      assert.equal(metaPinned.data.modelSource, "agent-pin");
    }
  });
});

/**
 * 读回 session 绑定确认写已落盘，同时让出事件循环 tick（SQLite 写后立即读的可见性兜底）。
 * 写入与 handlePromptAgentMeta 内部的 resolve 之间隔着一次显式 read-back，
 * 既验证 SET 正确，又保证后续 meta 读取拿到最新绑定。
 */
async function verifyBindingCommitted(
  sessionId: string,
  expectedAgentId: string,
): Promise<void> {
  const read = await handleSessionsGetAgentBinding({ sessionId });
  assert.equal(read.ok, true);
  if (!read.ok) {
    return;
  }
  assert.equal(read.data.agentId, expectedAgentId);
}
