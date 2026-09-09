/**
 * 数据库备份导出保存框命名（T-E2）：
 * 默认名固定 nmbackup.db；filters 同时含 db 与 nmbackup——
 * Windows 上默认名扩展与 filter 不匹配时 Electron 会自动追加 filter 扩展
 * （产出 nmbackup.db.nmbackup），必须双扩展兜底。
 *
 * dialog 走 electron-stub 同一引用改写；取消路径不触盘。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { dialog } from "electron";
import { exportDatabaseBackup } from "../src/main/services/db-backup.service.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("exportDatabaseBackup 保存框命名与 filters", () => {
  let tempDir: string;
  const savedDialogs: unknown[][] = [];
  const originalShowSaveDialog = dialog.showSaveDialog;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-backup-name-"));
    await getDesktopRuntime();
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      savedDialogs.push(args);
      return { canceled: true, filePath: undefined };
    }) as typeof dialog.showSaveDialog;
  });

  after(async () => {
    dialog.showSaveDialog = originalShowSaveDialog;
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("默认名 nmbackup.db，filters 含 db 与 nmbackup（无窗口分支）", async () => {
    const runtime = await getDesktopRuntime();
    const result = await exportDatabaseBackup(runtime);
    assert.equal(result, "cancelled");
    assert.equal(savedDialogs.length, 1);
    const options = savedDialogs[0]![0] as {
      defaultPath: string;
      filters: { name: string; extensions: string[] }[];
    };
    assert.equal(options.defaultPath, "nmbackup.db");
    assert.deepEqual(options.filters[0]!.extensions, ["db", "nmbackup"]);
  });
});
