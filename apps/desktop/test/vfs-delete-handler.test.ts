/**
 * T-WEC7：VFS delete 后 capture；快照不含已删 path。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { handleVfsDelete, handleVfsWrite } from "../src/main/ipc/handlers/vfs.js";
import { handleWorktreeCaptureSessionBlock } from "../src/main/ipc/handlers/worktree.js";
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

    const project = await handleProjectsCreate({ name: "vfs-delete-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    const session = await handleSessionsCreate({
      projectId,
      title: "vfs-delete-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    const write = await handleVfsWrite({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/gone.md",
      content: "deleted-content",
    });
    assert.equal(write.ok, true);

    const capture = await handleWorktreeCaptureSessionBlock({
      projectId,
      sessionId,
    });
    assert.equal(capture.ok, true);
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-WEC7: VFS delete 后 capture；快照不含已删 path", async () => {
    const rt = await getDesktopRuntime();
    const beforeBlock = rt.worktreeBlockStore.getCapturedBlock(
      projectId,
      sessionId,
    );
    assert.notEqual(beforeBlock, undefined);
    assert.ok(beforeBlock!.worktreeDisplay.includes("gone.md"));

    const result = await handleVfsDelete({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/gone.md",
    });
    assert.equal(result.ok, true);

    const afterBlock = rt.worktreeBlockStore.getCapturedBlock(
      projectId,
      sessionId,
    );
    assert.notEqual(afterBlock, undefined);
    assert.equal(typeof afterBlock!.capturedAtMs, "number");
    assert.ok(!afterBlock!.worktreeDisplay.includes("gone.md"));
    assert.ok(afterBlock!.capturedAtMs >= beforeBlock!.capturedAtMs);
  });
});
