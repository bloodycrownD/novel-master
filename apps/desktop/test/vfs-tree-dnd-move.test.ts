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

    const project = await Projects.create({ name: "vfs-move-ipc" });
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
      title: "vfs-move-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    const mkdir = await Vfs.mkdir({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/dest",
    });
    assert.equal(mkdir.ok, true);

    const write = await Vfs.write({
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

    const result = await Vfs.rename({
      workspaceScope: "chat",
      projectId,
      sessionId,
      oldPath: "/src/note.md",
      newPath,
    });
    assert.equal(result.ok, true);

    const gone = await Vfs.read({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/src/note.md",
    });
    assert.equal(gone.ok, false);

    const moved = await Vfs.read({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/dest/note.md",
    });
    assert.equal(moved.ok, true);
    if (moved.ok) {
      assert.equal(moved.data.content, "move-me");
    }

    const rtR = await DesktopRuntimeSingleton.get();
    if (!rtR.ok) throw rtR.error;
    const rt = rtR.value;
    // 错误通道迁移四期：read 已知失败沿 Result.err（不再 reject）。
    const missing = await rt.sessionVfs(projectId, sessionId).read("/src/note.md");
    assert.equal(missing.ok, false);
  });
});
