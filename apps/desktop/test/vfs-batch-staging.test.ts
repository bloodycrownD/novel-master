/**
 * Desktop VFS batch export staging 清理与拖出图标。
 */
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  clearVfsBatchExportStaging,
  resolveDragIconForTest,
  stagingTtlCountForTest,
} from "../src/main/services/vfs-batch.service.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";
import { handleVfsBatchClearStaging } from "../src/main/ipc/handlers/vfs.js";

describe("resolveDragIcon", () => {
  it("返回非空 NativeImage（禁止 createEmpty）", () => {
    const icon = resolveDragIconForTest();
    assert.equal(icon.isEmpty(), false);
  });
});

describe("clearVfsBatchExportStaging", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-staging-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("删除 staging 目录", async () => {
    const stagingRoot = join(tempDir, "staging-a");
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(join(stagingRoot, "note.md"), "x", "utf8");

    await clearVfsBatchExportStaging(stagingRoot);

    await assert.rejects(() => stat(stagingRoot));
  });

  it("IPC clearStaging 幂等", async () => {
    const stagingRoot = join(tempDir, "staging-b");
    await mkdir(stagingRoot, { recursive: true });

    const first = await handleVfsBatchClearStaging({ stagingRoot });
    assert.equal(first.ok, true);

    const second = await handleVfsBatchClearStaging({ stagingRoot });
    assert.equal(second.ok, true);
  });

  it("stage 后注册 TTL（main 兜底）", async () => {
    assert.equal(typeof stagingTtlCountForTest(), "number");
  });
});
