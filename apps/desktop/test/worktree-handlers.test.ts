/**
 * Worktree IPC：规则保存不 capture；遗留 captureSessionBlock IPC 改为 clear kkv。
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

  it("session buildListRows 成功", async () => {
    const result = await handleWorktreeBuildListRows({
      workspaceScope: "chat",
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(Array.isArray(result.data));
    }
  });

  it("setDirRule 成功且不写 file_cache（无 capture）", async () => {
    const rt = await getDesktopRuntime();
    const keysBefore = await rt.sessionKkv.listKeys(sessionId, "file_cache");

    const result = await handleWorktreeSetDirRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/",
      ruleEnabled: true,
    });

    assert.equal(result.ok, true);
    const keysAfter = await rt.sessionKkv.listKeys(sessionId, "file_cache");
    assert.deepEqual(keysAfter, keysBefore);
  });

  it("setFileRule 成功且不写 file_cache（无 capture）", async () => {
    const rt = await getDesktopRuntime();
    const keysBefore = await rt.sessionKkv.listKeys(sessionId, "file_cache");

    const result = await handleWorktreeSetFileRule({
      workspaceScope: "chat",
      projectId,
      sessionId,
      logicalPath: "/note.md",
      inclusionMode: "show",
    });

    assert.equal(result.ok, true);
    const keysAfter = await rt.sessionKkv.listKeys(sessionId, "file_cache");
    assert.deepEqual(keysAfter, keysBefore);
  });

  it("captureSessionBlock 遗留 IPC 清空 session kkv", async () => {
    const rt = await getDesktopRuntime();
    await rt.sessionKkv.set(
      sessionId,
      "file_cache",
      "full:/z.md",
      JSON.stringify({ body: "z", mtimeMs: 1 }),
    );

    const result = await handleWorktreeCaptureSessionBlock({
      projectId,
      sessionId,
    });

    assert.equal(result.ok, true);
    assert.equal(
      await rt.sessionKkv.get(sessionId, "file_cache", "full:/z.md"),
      null,
    );
  });
});
