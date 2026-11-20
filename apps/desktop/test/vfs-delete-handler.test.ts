/**
 * VFS delete：清理规则；不再 capture BlockStore。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
import { Projects } from "../src/main/ipc/handlers/projects.js";
import { AgentRegistry } from "../src/main/ipc/handlers/agent-registry.js";
import { Agent } from "../src/main/ipc/handlers/agent.js";
import { Sessions } from "../src/main/ipc/handlers/sessions.js";
import { Vfs } from "../src/main/ipc/handlers/vfs.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("handleVfsDelete", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-delete-"));

    const project = await Projects.create({ name: "vfs-delete-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下 session 创建要求 workspace 已配置 agent。
    const blank = await AgentRegistry.createBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await Agent.setCurrent({ agentId: blank.data.agentId });
    }

    const session = await Sessions.create({
      projectId,
      title: "vfs-delete-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    const write = await Vfs.write({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/gone.md",
      content: "deleted-content",
    });
    assert.equal(write.ok, true);
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("VFS delete 成功且不写 file_cache（无 capture）", async () => {
    const rtR = await DesktopRuntimeSingleton.get();
    if (!rtR.ok) throw rtR.error;
    const rt = rtR.value;
    const keysBefore = await rt.sessionKkv.listKeys(sessionId, "file_cache");

    const result = await Vfs.remove({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/gone.md",
    });
    assert.equal(result.ok, true);

    const keysAfter = await rt.sessionKkv.listKeys(sessionId, "file_cache");
    assert.deepEqual(keysAfter, keysBefore);

    // 错误通道迁移四期：read 已知失败沿 Result.err（不再 reject）。
    const missing = await rt.sessionVfs(projectId, sessionId).read("/gone.md");
    assert.equal(missing.ok, false);
  });
});
