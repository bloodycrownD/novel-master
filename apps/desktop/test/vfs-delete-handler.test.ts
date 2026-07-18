/**
 * VFS delete：清理规则；不再 capture BlockStore。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { handleVfsDelete, handleVfsWrite } from "../src/main/ipc/handlers/vfs.js";
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
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("VFS delete 成功且不写 file_cache（无 capture）", async () => {
    const rt = await getDesktopRuntime();
    const keysBefore = await rt.sessionKkv.listKeys(sessionId, "file_cache");

    const result = await handleVfsDelete({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/gone.md",
    });
    assert.equal(result.ok, true);

    const keysAfter = await rt.sessionKkv.listKeys(sessionId, "file_cache");
    assert.deepEqual(keysAfter, keysBefore);

    await assert.rejects(
      () => rt.sessionVfs(projectId, sessionId).read("/gone.md"),
    );
  });
});
