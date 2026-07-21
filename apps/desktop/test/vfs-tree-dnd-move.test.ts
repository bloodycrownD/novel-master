/**
 * T-B7：树内 MIME move 后原路径不存在；纯逻辑 + rename IPC。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  decodeVfsDragPayload,
  encodeVfsDragPayload,
  isSelfOrAncestorPath,
  NM_VFS_PATHS_MIME,
  resolveMoveDestination,
} from "@/features/workspace/vfs-tree-dnd";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  handleVfsMkdir,
  handleVfsRead,
  handleVfsRename,
  handleVfsWrite,
} from "../src/main/ipc/handlers/vfs.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("vfs-tree-dnd helpers (T-B7)", () => {
  it("MIME round-trip", () => {
    const raw = encodeVfsDragPayload(["/a/b.md", "/c"]);
    assert.equal(NM_VFS_PATHS_MIME, "application/x-nm-vfs-paths");
    const decoded = decodeVfsDragPayload(raw);
    assert.deepEqual(decoded?.paths, ["/a/b.md", "/c"]);
  });

  it("resolveMoveDestination 保留 basename", () => {
    assert.equal(resolveMoveDestination("/chap/a.md", "/out"), "/out/a.md");
    assert.equal(resolveMoveDestination("/chap/a.md", "/"), "/a.md");
    assert.equal(resolveMoveDestination("/dir", "/other"), "/other/dir");
  });

  it("禁止拖到自身或后代", () => {
    assert.equal(isSelfOrAncestorPath("/a", "/a"), true);
    assert.equal(isSelfOrAncestorPath("/a", "/a/b"), true);
    assert.equal(isSelfOrAncestorPath("/a/b", "/a"), false);
    assert.equal(isSelfOrAncestorPath("/a", "/b"), false);
  });
});

describe("handleVfsRename move 后原路径不存在 (T-B7)", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-move-"));

    const project = await handleProjectsCreate({ name: "vfs-move-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    const session = await handleSessionsCreate({
      projectId,
      title: "vfs-move-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    const mkdir = await handleVfsMkdir({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/dest",
    });
    assert.equal(mkdir.ok, true);

    const write = await handleVfsWrite({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/src/note.md",
      content: "move-me",
    });
    assert.equal(write.ok, true);
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("rename 后原路径不可读、新路径可读", async () => {
    const newPath = resolveMoveDestination("/src/note.md", "/dest");
    assert.equal(newPath, "/dest/note.md");

    const result = await handleVfsRename({
      workspaceScope: "chat",
      projectId,
      sessionId,
      oldPath: "/src/note.md",
      newPath,
    });
    assert.equal(result.ok, true);

    const gone = await handleVfsRead({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/src/note.md",
    });
    assert.equal(gone.ok, false);

    const moved = await handleVfsRead({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/dest/note.md",
    });
    assert.equal(moved.ok, true);
    if (moved.ok) {
      assert.equal(moved.data.content, "move-me");
    }

    const rt = await getDesktopRuntime();
    await assert.rejects(() =>
      rt.sessionVfs(projectId, sessionId).read("/src/note.md"),
    );
  });
});
