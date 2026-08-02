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
 * T-D2：handlePromptAgentMeta 消费 req.sessionId（session-bind 由 session 维度触发）。
 * T-M1 desktop：session-bind source + modelSource 三档（agent-pin / session-override / workspace）。
 */
describe("sessions agent-binding IPC handlers + prompt meta", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-sessions-agent-binding-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-D1：getAgentBinding 默认 follow；setAgentBinding round-trip bind / 解绑 follow", async () => {
    const project = await handleProjectsCreate({ name: "绑定测试" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "s1",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    const sessionId = session.data.id;

    // 默认 follow（老会话 agent_config_json 为 NULL → DEFAULT）
    const initial = await handleSessionsGetAgentBinding({ sessionId });
    assert.equal(initial.ok, true);
    if (initial.ok) {
      assert.deepEqual(initial.data, { mode: "follow" });
    }

    // 绑定到某 agent
    const bound = await handleSessionsSetAgentBinding({
      sessionId,
      agentId: "agent-x",
    });
    assert.equal(bound.ok, true);
    if (bound.ok) {
      assert.equal(bound.data.mode, "bind");
      if (bound.data.mode === "bind") {
        assert.equal(bound.data.agentId, "agent-x");
      }
    }

    // 重新读回一致
    const reread = await handleSessionsGetAgentBinding({ sessionId });
    assert.equal(reread.ok, true);
    if (reread.ok) {
      assert.equal(reread.data.mode, "bind");
    }

    // 解绑（agentId=null → follow）
    const unbound = await handleSessionsSetAgentBinding({
      sessionId,
      agentId: null,
    });
    assert.equal(unbound.ok, true);
    if (unbound.ok) {
      assert.deepEqual(unbound.data, { mode: "follow" });
    }
  });

  it("T-D1：setModelOverride 在 bind 下写 modelId；清除回 undefined", async () => {
    const project = await handleProjectsCreate({ name: "模型覆盖测试" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "s2",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    const sessionId = session.data.id;

    // 先绑定 agent，再覆盖模型
    await handleSessionsSetAgentBinding({ sessionId, agentId: "agent-y" });
    const overridden = await handleSessionsSetModelOverride({
      sessionId,
      modelId: "model-override-1",
    });
    assert.equal(overridden.ok, true);
    if (overridden.ok) {
      assert.equal(overridden.data.mode, "bind");
      if (overridden.data.mode === "bind") {
        assert.equal(overridden.data.modelId, "model-override-1");
      }
    }

    // 清除覆盖（mode/agentId 保持）
    const cleared = await handleSessionsSetModelOverride({
      sessionId,
      modelId: null,
    });
    assert.equal(cleared.ok, true);
    if (cleared.ok) {
      assert.equal(cleared.data.mode, "bind");
      if (cleared.data.mode === "bind") {
        assert.equal(cleared.data.modelId, undefined);
      }
    }
  });

  it("T-D2 + T-M1：handlePromptAgentMeta 消费 sessionId，session-bind source 与 modelSource 三档正确", async () => {
    // 先触发 singleton 初始化（handler 内部调 getDesktopRuntime），再注册 agent
    const project = await handleProjectsCreate({ name: "Meta 三档" });
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

    // ① session-bind + agent 无 pin + 无 modelId → modelSource = workspace
    await handleSessionsSetAgentBinding({ sessionId, agentId: "agent-plain" });
    await verifyBindingCommitted(sessionId, { mode: "bind", agentId: "agent-plain" });
    const metaPlain = await handlePromptAgentMeta({ projectId, sessionId });
    assert.equal(metaPlain.ok, true);
    if (metaPlain.ok) {
      assert.equal(metaPlain.data.source, "session-bind");
      assert.equal(metaPlain.data.agentId, "agent-plain");
      assert.equal(metaPlain.data.hasDedicatedModel, false);
      assert.equal(metaPlain.data.modelSource, "workspace");
    }

    // ② session-bind + agent 无 pin + session modelId 覆盖 → modelSource = session-override
    await handleSessionsSetModelOverride({
      sessionId,
      modelId: "session-model-x",
    });
    await verifyBindingCommitted(sessionId, {
      mode: "bind",
      agentId: "agent-plain",
      modelId: "session-model-x",
    });
    const metaOverride = await handlePromptAgentMeta({ projectId, sessionId });
    assert.equal(metaOverride.ok, true);
    if (metaOverride.ok) {
      assert.equal(metaOverride.data.source, "session-bind");
      assert.equal(metaOverride.data.hasDedicatedModel, false);
      assert.equal(metaOverride.data.modelSource, "session-override");
    }

    // ③ session-bind + agent 带 pin → modelSource = agent-pin（pin 压制 session 覆盖）
    await handleSessionsSetAgentBinding({ sessionId, agentId: "agent-pinned" });
    await verifyBindingCommitted(sessionId, {
      mode: "bind",
      agentId: "agent-pinned",
    });
    const metaPinned = await handlePromptAgentMeta({ projectId, sessionId });
    assert.equal(metaPinned.ok, true);
    if (metaPinned.ok) {
      assert.equal(metaPinned.data.source, "session-bind");
      assert.equal(metaPinned.data.agentId, "agent-pinned");
      assert.equal(metaPinned.data.hasDedicatedModel, true);
      assert.equal(metaPinned.data.modelSource, "agent-pin");
    }

    // ④ 解绑回 follow → 不再是 session-bind
    await handleSessionsSetAgentBinding({ sessionId, agentId: null });
    await verifyBindingCommitted(sessionId, { mode: "follow" });
    const metaFollow = await handlePromptAgentMeta({ projectId, sessionId });
    assert.equal(metaFollow.ok, true);
    if (metaFollow.ok) {
      assert.notEqual(metaFollow.data.source, "session-bind");
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
  expected: { mode: "follow" } | { mode: "bind"; agentId: string; modelId?: string },
): Promise<void> {
  const read = await handleSessionsGetAgentBinding({ sessionId });
  assert.equal(read.ok, true);
  if (!read.ok) {
    return;
  }
  assert.equal(read.data.mode, expected.mode);
  if (expected.mode === "bind" && read.data.mode === "bind") {
    assert.equal(read.data.agentId, expected.agentId);
  }
}
