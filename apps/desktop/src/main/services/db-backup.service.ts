/**
 * 全量 SQLite 数据库导出/导入（文件级拷贝 + 服务商表隔离）。
 *
 * 调用链契约（两端一致）：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
 * 导入函数只负责前两步的库面动作，并如实回报「库文件是否已被替换」
 * （{@link DbImportOutcome.databaseReplaced}）；调用方据此决定是否重建 runtime，
 * 记账必须排在重建之后，互斥令牌必须排在记账之后。
 *
 * @module services/db-backup
 */
import { access, copyFile, open as openFileHandle, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import {
  dumpProviderTableSnapshot,
  open,
  restoreProviderTableSnapshot,
  scrubProviderTablesInDatabase,
  type ProviderTableSnapshot,
  type TdbcConnection,
} from "@novel-master/core";
import { registerBetterSqlite3Driver } from "@novel-master/tdbc-driver-better-sqlite3";
import {
  checkpointDesktopDatabase,
  closeDesktopConnection,
  getDesktopConnection,
} from "../runtime/connection.js";
import { clearDesktopRuntimeHandle } from "../runtime/desktop-runtime-singleton.js";
import { resolveDbPath } from "../runtime/resolve-db-path.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import {
  acquireDesktopDbMaintenanceBusy,
  releaseDesktopDbMaintenanceBusy,
} from "./db-maintenance-busy.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/** Close live DB only after dropping the runtime handle (avoids stale conn use). */
async function closeLiveDbForBackupImport(): Promise<void> {
  clearDesktopRuntimeHandle();
  await closeDesktopConnection();
}

const SQLITE_MAGIC = "SQLite format 3";
const SQLITE_HEADER_BYTES = 16;
const EXPORT_ATTACH_ALIAS = "export_db";

/**
 * 导入结果：如实回报「活动库文件是否已被替换」与「服务商三表是否已在本机恢复」。
 *
 * 成功路径走返回值；抛错路径（覆盖已成功、收尾失败）走 {@link DatabaseReplacedError}
 * ——函数抛错时返回值送不到调用方，「已换代」信号必须由异常类型承载。
 */
export type DbImportOutcome = {
  /** 活动库文件是否已被替换（true ⇒ 调用方持有的 runtime/conn 一律作废，必须先重建再用）。 */
  databaseReplaced: boolean;
  /** 服务商三表是否已在本机恢复成功（false ⇒ 数据库已换但三表丢失，需 UI 提示）。 */
  providerTablesRestored: boolean;
};

/**
 * 库文件已换代、其后收尾步骤失败：信号随异常送达（成功路径走 {@link DbImportOutcome} 返回值）。
 *
 * 此时**不得回滚**——库已经是新快照，回滚会把用户拉回来的数据丢掉。
 */
export class DatabaseReplacedError extends Error {
  readonly databaseReplaced = true as const;

  constructor(
    message: string,
    readonly providerTablesRestored: boolean,
  ) {
    super(message);
    this.name = "DatabaseReplacedError";
  }
}

/**
 * fs 操作的可注入缝。
 *
 * desktop 测试基座是 node:test 零 mock 设施（`mock.module`/`jest.mock`/`vi.mock`
 * 对 apps/desktop/test 全零命中，唯一既有缝是改对象属性），ESM 具名导入无法
 * monkey-patch ⇒ 需要观测 copyFile/unlink/open 行为时走这个缝，
 * 测试在 finally 里恢复原实现。
 */
const fsOps: {
  copyFile: typeof copyFile;
  unlink: typeof unlink;
  open: typeof openFileHandle;
} = {
  copyFile,
  unlink,
  open: openFileHandle,
};

/** 测试缝：替换 fs 操作实现。测试负责在 finally 恢复原实现。 */
export function __setDbBackupFsOpsForTest(
  ops: Partial<typeof fsOps> | null,
): void {
  fsOps.copyFile = ops?.copyFile ?? copyFile;
  fsOps.unlink = ops?.unlink ?? unlink;
  fsOps.open = ops?.open ?? openFileHandle;
}

function backupFileName(): string {
  return "nmbackup.db";
}

function assertSqliteFile(bytes: Uint8Array): void {
  if (bytes.length < 16) {
    throw new Error("文件过小，不是有效的数据库备份");
  }
  const header = String.fromCharCode(...bytes.subarray(0, 16));
  if (!header.startsWith(SQLITE_MAGIC)) {
    throw new Error("不是有效的 SQLite 数据库备份");
  }
}

/**
 * 路径级校验：只读前 16 字节确认 SQLite 魔数。
 *
 * 禁止 `readFile(path, enc, 16)`（第三参会被忽略，整包读入 ⇒ 大备份撑爆 Node 堆），
 * 也禁止裸 `readFile` 整包进内存。手机端同款防呆注释见 apps/mobile 的
 * `assertSqliteBackupAtPath`。
 */
async function assertSqliteFileAtPath(srcPath: string): Promise<void> {
  const handle = await fsOps.open(srcPath, "r");
  try {
    const buf = Buffer.alloc(SQLITE_HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SQLITE_HEADER_BYTES, 0);
    assertSqliteFile(new Uint8Array(buf.subarray(0, bytesRead)));
  } finally {
    await handle.close();
  }
}

/** 目标库是否已存在（全新安装首次导入时不存在 ⇒ 无可备份、无可回滚）。 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 短连接打开 live DB，仅用于导入后恢复本机服务商三表（不跑 bootstrap）。
 */
async function openDbForProviderRestore(): Promise<TdbcConnection> {
  registerBetterSqlite3Driver();
  const dbPath = resolve(resolveDbPath());
  return open(`tdbc:sqlite:file:${dbPath}`, { driver: "better-sqlite3" });
}

/**
 * 将数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商三表），无文件对话框。
 * 调用方负责 Agent 守卫与目标路径管理。
 *
 * ic-20：busy 为计数/令牌配对——底层入口 acquire、出口 finally release
 * 自平衡（云同步等直接调底层的路径「期间 true、结束后 false」天然成立）；
 * 最外层流程（备份导入 / 云同步 pull）另持一枚令牌、在 rebootstrap 完成
 * 之后 release，含重建窗口的完整互斥。计数语义下嵌套调用互不提前清位。
 */
export async function exportDatabaseBackupToPath(
  runtime: DesktopNovelMasterRuntime,
  destPath: string,
): Promise<void> {
  acquireDesktopDbMaintenanceBusy();
  try {
    await checkpointDesktopDatabase(runtime.conn);
    const dbPath = resolveDbPath();
    await copyFile(dbPath, destPath);
    await scrubProviderTablesInDatabase(
      runtime.conn,
      destPath,
      EXPORT_ATTACH_ALIAS,
    );
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}

/**
 * 「备份 → 关连接 → 覆盖 → 恢复三表」的危险动作链，两条导入路径共用。
 *
 * 错误处理口径（备份三处吞错治理）：
 * - 备份步裸 await，失败即抛，**绝不 .catch 吞掉**：吞掉之后覆盖照跑，
 *   「备份失败 → 覆盖成功 → 回滚失败」这条链路上没有任何一处会中断，
 *   最终库文件已是远端快照而本地改动无声消失。
 * - 回滚只覆盖「覆盖动作本身失败」这一段；覆盖已成功后（databaseReplaced）
 *   抛 {@link DatabaseReplacedError}，**不回滚**——库已经是新快照。
 * - 回滚失败必须并入错误信息并保留 bak 副本（用户要能手工救回）；
 *   回滚成功时 bak 冗余，finally 删掉；unlink 本身仍可吞但留 console.error 痕迹。
 *
 * @param replace 覆盖动作：FromPath 走 copyFile，FromBytes 走 writeFile。
 * @param providerSnapshot 覆盖前 dump 的本机服务商三表。
 */
async function replaceLiveDatabase(
  replace: (dbPath: string) => Promise<void>,
  providerSnapshot: ProviderTableSnapshot,
): Promise<void> {
  const dbPath = resolveDbPath();
  const bakPath = `${dbPath}.nmbackup.bak`;

  let bakCreated = false;
  let rollbackFailed = false;
  let databaseReplaced = false;

  try {
    if (await fileExists(dbPath)) {
      await fsOps.copyFile(dbPath, bakPath);
      bakCreated = true;
    }
    await closeLiveDbForBackupImport();
    await replace(dbPath);
    databaseReplaced = true;

    const restoreConn = await openDbForProviderRestore();
    try {
      await restoreProviderTableSnapshot(restoreConn, providerSnapshot);
    } finally {
      await restoreConn.close();
    }
  } catch (error) {
    if (databaseReplaced) {
      // 库已是新快照：不回滚，只把「已换代 + 三表未恢复」如实报上去。
      throw new DatabaseReplacedError(
        `数据库已导入，但本机服务商配置恢复失败：${errorDetail(error)}`,
        false,
      );
    }

    // 覆盖动作本身失败：库仍是旧库（或根本没换），回滚到备份。
    let rollbackError: unknown;
    if (bakCreated) {
      try {
        await fsOps.copyFile(bakPath, dbPath);
      } catch (e) {
        rollbackError = e;
      }
    }
    if (rollbackError != null) {
      rollbackFailed = true;
      throw new Error(
        `数据库导入失败且回滚失败，回滚副本保留在 ${bakPath}：${errorDetail(rollbackError)}`,
        { cause: [error, rollbackError] },
      );
    }
    throw error;
  } finally {
    if (bakCreated && !rollbackFailed) {
      await fsOps.unlink(bakPath).catch((unlinkError: unknown) => {
        console.error(
          `[db-backup] 清理回滚副本失败（不影响数据正确性）: ${bakPath}`,
          unlinkError,
        );
      });
    }
  }
}

/**
 * 从本地快照文件导入数据库（路径级校验 → close → cp 替换 → restore），无对话框与 rebootstrap。
 * 调用方须在 `databaseReplaced === true` 时执行 rebootstrap，再记账、最后放互斥令牌。
 *
 * ic-20：busy 为计数/令牌配对——底层 acquire/release 自平衡，覆盖「关连接
 * + 覆盖库文件」窗口；最外层流程在 rebootstrap 完成之后 release（见
 * backup.ts / cloud-sync.ts 调用路径），含重建窗口的完整互斥。
 */
export async function importDatabaseBackupFromPath(
  srcPath: string,
): Promise<DbImportOutcome> {
  acquireDesktopDbMaintenanceBusy();
  try {
    // 路径级校验：只读 16 字节魔数，不整包读入。
    await assertSqliteFileAtPath(srcPath);

    const liveConn = await getDesktopConnection();
    const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

    await replaceLiveDatabase(
      (dbPath) => fsOps.copyFile(srcPath, dbPath),
      providerSnapshot,
    );
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
  return { databaseReplaced: true, providerTablesRestored: true };
}

/**
 * 从内存中的备份字节导入数据库（dump → close → replace → restore），无对话框与 rebootstrap。
 * 调用方须在 `databaseReplaced === true` 时执行 rebootstrap，再记账、最后放互斥令牌。
 *
 * ic-20：busy 为计数/令牌配对——同 {@link importDatabaseBackupFromPath}。
 */
export async function importDatabaseBackupFromBytes(
  bytes: Uint8Array,
): Promise<DbImportOutcome> {
  acquireDesktopDbMaintenanceBusy();
  try {
    // 内存态校验：bytes 已在堆上，不涉及整包读盘。
    assertSqliteFile(bytes);

    const liveConn = await getDesktopConnection();
    const providerSnapshot = await dumpProviderTableSnapshot(liveConn);

    await replaceLiveDatabase(
      (dbPath) => writeFile(dbPath, bytes),
      providerSnapshot,
    );
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
  return { databaseReplaced: true, providerTablesRestored: true };
}

export async function exportDatabaseBackup(
  runtime: DesktopNovelMasterRuntime,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  if (isDesktopAgentActive()) {
    throw new Error("Agent 运行中，请稍后再导出数据库");
  }

  const fileName = backupFileName();
  const win = parentWindow ?? undefined;

  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: fileName,
        filters: [
          { name: "Novel Master Backup", extensions: ["db", "nmbackup"] },
        ],
      })
    : await dialog.showSaveDialog({
        defaultPath: fileName,
        filters: [
          { name: "Novel Master Backup", extensions: ["db", "nmbackup"] },
        ],
      });
  if (result.canceled || result.filePath == null) {
    return "cancelled";
  }

  await exportDatabaseBackupToPath(runtime, result.filePath);
  return "saved";
}

export async function importDatabaseBackup(
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  if (isDesktopAgentActive()) {
    throw new Error("Agent 运行中，请稍后再导入数据库");
  }

  const win = parentWindow ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, {
        filters: [
          { name: "Novel Master Backup", extensions: ["nmbackup", "db"] },
        ],
        properties: ["openFile"],
      })
    : await dialog.showOpenDialog({
        filters: [
          { name: "Novel Master Backup", extensions: ["nmbackup", "db"] },
        ],
        properties: ["openFile"],
      });
  if (result.canceled || result.filePaths.length === 0) {
    return "cancelled";
  }

  const pickedPath = result.filePaths[0]!;
  // 走路径级导入：整包 readFile 会把 200MB 级备份拉进 Node 堆，
  // 且与 mobile（pick 到本地路径 → FromPath）的形态不一致。
  // 返回类型不变（"imported" | "cancelled"），调用方 handlers/backup.ts 零改动。
  await importDatabaseBackupFromPath(pickedPath);
  return "imported";
}
