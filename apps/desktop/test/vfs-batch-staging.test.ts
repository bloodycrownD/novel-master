/**
 * Desktop VFS batch export staging 清理与拖出图标。
 */
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { app } from "electron";
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

  /** staging 根的权威基准（与生产 `vfsBatchStagingBase()` 同一表达式）。 */
  const stagingBase = (): string =>
    join(app.getPath("userData"), "vfs-batch-export");

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-staging-"));
    await mkdir(stagingBase(), { recursive: true });
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("删除 staging 目录", async () => {
    // ⚠️ 夹具必须落在 `userData/vfs-batch-export` 之下：S-D-02 给清理通道补了路径
    // 包含断言，`tempDir`（系统 tmp）与 stub 的 userData 毫无包含关系 ⇒ 旧夹具必红。
    // 正确处置是修夹具，**不是**放宽守卫。
    const stagingRoot = join(stagingBase(), "case-a");
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(join(stagingRoot, "note.md"), "x", "utf8");

    await clearVfsBatchExportStaging(stagingRoot);

    await assert.rejects(() => stat(stagingRoot));
  });

  it("IPC clearStaging 幂等", async () => {
    const stagingRoot = join(stagingBase(), "case-b");
    await mkdir(stagingRoot, { recursive: true });

    const first = await handleVfsBatchClearStaging({ stagingRoot });
    assert.equal(first.ok, true);

    const second = await handleVfsBatchClearStaging({ stagingRoot });
    assert.equal(second.ok, true);
  });

  it("stage 后注册 TTL（main 兜底）", async () => {
    assert.equal(typeof stagingTtlCountForTest(), "number");
  });

  it("S-D-02-a: 拒绝清理 staging 根之外的路径", async () => {
    await assert.rejects(
      () => clearVfsBatchExportStaging(app.getPath("userData")),
      /拒绝清理/,
    );
  });

  it("S-D-02-b: 拒绝清理 staging 根的父目录（前缀撞车）", async () => {
    // 这条专门防「只判 startsWith(base) 不带分隔符」的错误实现——
    // `base + "-evil"` 这类前缀撞车必须也拒。
    const sibling = `${stagingBase()}-evil`;
    await assert.rejects(() => clearVfsBatchExportStaging(sibling), /拒绝清理/);
    // join(base, "..") resolve 后落在 base 之外 ⇒ 同样拒
    await assert.rejects(
      () => clearVfsBatchExportStaging(join(stagingBase(), "..")),
      /拒绝清理/,
    );
    // 系统根也必须拒（原先 rm('/', {recursive:true}) 会被执行）
    await assert.rejects(() => clearVfsBatchExportStaging("/"), /拒绝清理/);
  });

  it("S-D-02-c: staging 根本身与其下子目录仍可清理（正向不回归）", async () => {
    const self = stagingBase();
    // 清空 staging 根本身是合法的（IPC 通道允许 base 命中自身）
    await clearVfsBatchExportStaging(self);
    await assert.rejects(() => stat(self));

    await mkdir(self, { recursive: true });
    const child = join(self, "case-c");
    await mkdir(child, { recursive: true });
    await clearVfsBatchExportStaging(child);
    await assert.rejects(() => stat(child));
  });
});