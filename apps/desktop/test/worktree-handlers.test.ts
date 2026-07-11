/**
 * Worktree IPC 处理器测试：session 列表走实时 buildListRows；规则 / 手动 capture。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  handleWorktreeBuildListRows,
  handleWorktreeCaptureSessionBlock,
  handleWorktreeSetDirRule,
  handleWorktreeSetFileRule,
} from "../src/main/ipc/handlers/worktree.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("worktree ipc handlers", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-worktree-"));

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
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("session buildListRows 不经 block store capture", async () => {
    const rt = await getDesktopRuntime();
    let captureCalls = 0;
    const originalCapture =
      rt.worktreeBlockStore.capture.bind(rt.worktreeBlockStore);
    rt.worktreeBlockStore.capture = (...args) => {
      captureCalls += 1;
      return originalCapture(...args);
    };

    const result = await handleWorktreeBuildListRows({
      workspaceScope: "chat",
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    assert.equal(captureCalls, 0);
    if (result.ok) {
      assert.ok(Array.isArray(result.data));
    }
  });

  it("T-WEC6: setDirRule 成功后 capture", async () => {
    const rt = await getDesktopRuntime();
    rt.worktreeBlockStore.clear(projectId, sessionId);
    assert.equal(
      rt.worktreeBlockStore.getCapturedBlock(projectId, sessionId),
      undefined,
    );

    const result = await handleWorktreeSetDirRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/",
      ruleEnabled: true,
    });

    assert.equal(result.ok, true);
    const block = rt.worktreeBlockStore.getCapturedBlock(projectId, sessionId);
    assert.notEqual(block, undefined);
    assert.equal(typeof block!.capturedAtMs, "number");
  });

  it("T-WEC6: setFileRule 成功后 capture", async () => {
    const rt = await getDesktopRuntime();
    rt.worktreeBlockStore.clear(projectId, sessionId);

    const result = await handleWorktreeSetFileRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/note.md",
      inclusionMode: "show",
    });

    assert.equal(result.ok, true);
    const block = rt.worktreeBlockStore.getCapturedBlock(projectId, sessionId);
    assert.notEqual(block, undefined);
    assert.equal(typeof block!.capturedAtMs, "number");
  });

  it("T-WEC8: captureSessionBlock 立即 capture，不经 buildListRows store", async () => {
    const rt = await getDesktopRuntime();
    rt.worktreeBlockStore.clear(projectId, sessionId);
    assert.equal(
      rt.worktreeBlockStore.getCapturedBlock(projectId, sessionId),
      undefined,
    );

    const result = await handleWorktreeCaptureSessionBlock({
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    const block = rt.worktreeBlockStore.getCapturedBlock(projectId, sessionId);
    assert.notEqual(block, undefined);
    assert.equal(typeof block!.capturedAtMs, "number");
  });
});
