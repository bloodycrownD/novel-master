/**
 * Worktree IPC 处理器测试：session 列表走实时 buildListRows；invalidate smoke。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";
import { setDpapiTestPassthrough } from "@novel-master/sksp-windows";
import { closeDesktopConnection } from "../src/main/runtime/connection.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  handleWorktreeBuildListRows,
  handleWorktreeInvalidateSessionSnapshot,
} from "../src/main/ipc/handlers/worktree.js";

describe("worktree ipc handlers", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(true);
    } else {
      setDpapiTestPassthrough(true);
    }
    tempDir = await mkdtemp(join(tmpdir(), "nm-desktop-worktree-"));
    process.env.NOVEL_MASTER_DB = join(tempDir, "novel.db");

    const project = await handleProjectsCreate({ name: "worktree-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    const session = await handleSessionsCreate({
      projectId,
      title: "session-1",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;
  });

  after(async () => {
    await closeDesktopConnection();
    delete process.env.NOVEL_MASTER_DB;
    if (process.platform === "darwin") {
      setMacKeychainTestPassthrough(false);
    } else {
      setDpapiTestPassthrough(false);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("session buildListRows 不经 snapshot getOrRefresh", async () => {
    const rt = await getDesktopRuntime();
    let getOrRefreshCalls = 0;
    const originalGetOrRefresh =
      rt.worktreeSnapshot.getOrRefresh.bind(rt.worktreeSnapshot);
    rt.worktreeSnapshot.getOrRefresh = async (...args) => {
      getOrRefreshCalls += 1;
      return originalGetOrRefresh(...args);
    };

    const result = await handleWorktreeBuildListRows({
      workspaceScope: "chat",
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    assert.equal(getOrRefreshCalls, 0);
    if (result.ok) {
      assert.ok(Array.isArray(result.data));
    }
  });

  it("invalidateSessionSnapshot 标记 dirty（smoke）", async () => {
    const rt = await getDesktopRuntime();
    rt.worktreeSnapshot.markDirty(projectId, sessionId);
    assert.equal(rt.worktreeSnapshot.isDirty(projectId, sessionId), true);

    let markDirtyCalls = 0;
    const originalMarkDirty =
      rt.worktreeSnapshot.markDirty.bind(rt.worktreeSnapshot);
    rt.worktreeSnapshot.markDirty = (pid, sid) => {
      markDirtyCalls += 1;
      originalMarkDirty(pid, sid);
    };

    const result = await handleWorktreeInvalidateSessionSnapshot({
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    assert.equal(markDirtyCalls, 1);
    assert.equal(rt.worktreeSnapshot.isDirty(projectId, sessionId), true);
  });
});
