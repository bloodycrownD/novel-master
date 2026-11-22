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
import { DatabaseBackupExport, ProviderTableSnapshotIo, SqliteBackupHeader, TdbcOpen, type ProviderTableSnapshot } from "@novel-master/core";
import { AppError , type Outcome} from "@novel-master/core/errors";
import { Errors } from "@novel-master/core/common";
import { Result, type Interrupt } from "@novel-master/core/errors";
import { BetterSqlite3Register } from "@novel-master/tdbc-driver-better-sqlite3";
import { DesktopDb } from "../runtime/connection.js";
import { DesktopRuntimeSingleton } from "../runtime/desktop-runtime-singleton.js";
import { DesktopDbPath } from "../runtime/resolve-db-path.js";
import { agentActivity } from "../runtime/agent-activity.js";
import { maintenanceBusy } from "./db-maintenance-busy.js";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { LogFactory } from "@novel-master/core/log";

const log = LogFactory.create("desktop.db-backup");

const SQLITE_HEADER_BYTES = 16;

/**
 * 导入结果：如实回报「活动库文件是否已被替换」与「服务商三表是否已在本机恢复」。
 *
 * 成功路径走返回值；「覆盖已成功、收尾失败」沿 `DB_BACKUP_REPLACE_INCOMPLETE` 走 Result 通道
 * （error-matrix-final R2：全链路纯 Result，异常哨兵已退役）。
 */
type DbImportOutcome = {
  /** 活动库文件是否已被替换（true ⇒ 调用方持有的 runtime/conn 一律作废，必须先重建再用）。 */
  databaseReplaced: boolean;
  /** 服务商三表是否已在本机恢复成功（false ⇒ 数据库已换但三表丢失，需 UI 提示）。 */
  providerTablesRestored: boolean;
};

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

export namespace DbBackupService {
  /** 测试缝：替换 fs 操作实现。测试负责在 finally 恢复原实现。 */
  export function setFsOpsForTest(ops: Partial<typeof fsOps> | null): void {
    fsOps.copyFile = ops?.copyFile ?? copyFile;
    fsOps.unlink = ops?.unlink ?? unlink;
    fsOps.open = ops?.open ?? openFileHandle;
  }

  /**
   * 将数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商三表），无文件对话框。
   * 调用方负责 Agent 守卫与目标路径管理；共享链路在 core（{@link DatabaseBackupExport.toPath}），
   * 本壳只保留 desktop 的 busy 计数与平台注入点。
   *
   * ic-20：busy 为计数/令牌配对——底层入口 acquire、出口 finally release
   * 自平衡（云同步等直接调底层的路径「期间 true、结束后 false」天然成立）；
   * 最外层流程（备份导入 / 云同步 pull）另持一枚令牌、在 rebootstrap 完成
   * 之后 release，含重建窗口的完整互斥。计数语义下嵌套调用互不提前清位。
   */
  export async function exportToPath(runtime: DesktopNovelMasterRuntime, destPath: string, checkpoint?: () => Interrupt | null): Promise<Outcome<void>> {
    maintenanceBusy.acquire();
    try {
      // return await（非裸 return）：async try-finally 里裸 return promise 的 finally 先于 settle 执行，release 会提前放行 busy。
      return await DatabaseBackupExport.toPath(runtime.conn, destPath, { checkpointDatabase: DesktopDb.checkpoint, resolveDbPath: DesktopDbPath.resolve, copyFile }, checkpoint);
    } finally {
      maintenanceBusy.release();
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
   *   返回 `DB_BACKUP_REPLACE_INCOMPLETE`，**不回滚**——库已经是新快照。
   * - 三条终态各自对 bak 的处置：**①回滚失败** ⇒ 保留（用户要能手工救回）；
   *   **②覆盖失败且回滚成功** ⇒ 冗余，finally 删掉；**③覆盖成功但三表恢复失败**
   *   ⇒ 同样保留（CR-F01：此时 bak 是磁盘上唯一一份含未同步本地改动的旧库，
   *   删掉即无声丢数据），并把路径写进错误文案。
   *   unlink 本身仍可吞但留 console.error 痕迹。
   *
   * @param replace 覆盖动作：FromPath 走 copyFile，FromBytes 走 writeFile。
   * @param providerSnapshot 覆盖前 dump 的本机服务商三表。
   */
  async function replaceLiveDatabase(replace: (dbPath: string) => Promise<void>, providerSnapshot: ProviderTableSnapshot): Promise<Result<void, AppError>> {
    const dbPath = DesktopDbPath.resolve();
    const bakPath = `${dbPath}.nmbackup.bak`;

    let bakCreated = false;
    let rollbackFailed = false;
    let databaseReplaced = false;
    // 第三终态：覆盖已成功、只是三表恢复失败。此时库已是新快照（不能回滚），
    // 而 bak 正是「导入前的完整旧库」——含未同步的本地改动，是用户仅存的救回凭据。
    // 置位后 finally 不删它，并把路径写进错误文案（与 mobile 侧 finally 从不删 bak 一致）。
    let keepBackupForManualRecovery = false;

    try {
      // 目标库是否已存在（全新安装首次导入时不存在 ⇒ 无可备份、无可回滚）。
      let dbExists = true;
      try {
        await access(dbPath);
      } catch {
        dbExists = false;
      }
      if (dbExists) {
        await fsOps.copyFile(dbPath, bakPath);
        bakCreated = true;
      }
      // 关活动库只在丢掉 runtime 句柄之后（避免用到旧连接）。
      DesktopRuntimeSingleton.clearHandle();
      await DesktopDb.close();
      await replace(dbPath);
      databaseReplaced = true;

      // 短连接打开 live DB，仅用于导入后恢复本机服务商三表（不跑 bootstrap）。
      BetterSqlite3Register.register();
      const restoreDbPath = resolve(DesktopDbPath.resolve());
      const restoreConn = await TdbcOpen.open(`tdbc:sqlite:file:${restoreDbPath}`, { driver: "better-sqlite3" });
      try {
        await ProviderTableSnapshotIo.restore(restoreConn, providerSnapshot);
      } finally {
        await restoreConn.close();
      }
    } catch (error) {
      if (databaseReplaced) {
        // 终态③：库已是新快照，不回滚，只把「已换代 + 三表未恢复」如实报上去。
        // 但覆盖前的旧库副本是用户导入前那份完整旧库（含未同步本地改动）——
        // 此刻它是磁盘上唯一的一份，删掉等于让用户无声丢失本地数据。
        keepBackupForManualRecovery = true;
        const recoveryHint = bakCreated ? `导入前的旧库副本已保留在 ${bakPath}（未回滚，需要时可手工替换回来）。` : "导入前没有可备份的活动库文件，无旧库副本可保留。";
        const reason = Errors.text(error);
        // error-matrix-final R2：「已换代 + 收尾失败」沿 DB_BACKUP_REPLACE_INCOMPLETE 走
        // Result 通道（providerTablesRestored 进 details）——异常哨兵 DatabaseReplacedError 退役。
        // 此时不得回滚：库已是新快照，回滚会把用户拉回来的数据丢掉。
        // detail 保持旧 message 口径（完整中文句，边界 formatIpcError 直出给用户）。
        // cause 必须走第三参 options——塞进 params 会被 firstDescriptorOf 误认成
        // descriptor（AppError 实例带 key 字段），把 messageKey 污染成内层错误 key。
        return Result.err(new AppError("DB_BACKUP_REPLACE_INCOMPLETE", {detail: `数据库已导入，但本机服务商配置恢复失败：${reason}${recoveryHint}`, reason, recoveryHint, providerTablesRestored: false}, {cause: error}));
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
        return Result.err(new AppError("INFRA_UNEXPECTED_ERROR", { detail: `数据库导入失败且回滚失败，回滚副本保留在 ${bakPath}：${Errors.text(rollbackError)}` }, { cause: [error, rollbackError] }));
      }
      // 覆盖动作失败但回滚已成功（库已恢复旧态）：转 Result 是对现状的诚实标记
      // （error-matrix-final §一.2——回滚后原异常不再精确描述当前状态）。
      return Result.err(error instanceof AppError ? error : new AppError("INFRA_UNEXPECTED_ERROR", { detail: `数据库导入失败（已回滚到导入前状态）：${Errors.text(error)}` }, { cause: error }));
    } finally {
      if (bakCreated && !rollbackFailed && !keepBackupForManualRecovery) {
        await fsOps.unlink(bakPath).catch((unlinkError: unknown) => {
          log.error("清理回滚副本失败（不影响数据正确性）", { path: bakPath, error: unlinkError });
        });
      }
    }
    return Result.ok(undefined);
  }

  /**
   * 从本地快照文件导入数据库（路径级校验 → close → cp 替换 → restore），无对话框与 rebootstrap。
   * 调用方须在 `databaseReplaced === true` 时执行 rebootstrap，再记账、最后放互斥令牌。
   *
   * ic-20：busy 为计数/令牌配对——底层 acquire/release 自平衡，覆盖「关连接
   * + 覆盖库文件」窗口；最外层流程在 rebootstrap 完成之后 release（见
   * backup.ts / cloud-sync.ts 调用路径），含重建窗口的完整互斥。
   */
  export async function importFromPath(srcPath: string): Promise<Result<DbImportOutcome, AppError>> {
    maintenanceBusy.acquire();
    try {
      // 路径级校验：只读前 16 字节确认 SQLite 魔数，不整包读入。禁止 `readFile(path, enc, 16)`
      // （第三参会被忽略，整包读入 ⇒ 大备份撑爆 Node 堆），也禁止裸 `readFile` 整包进内存。
      // 已知失败（非备份文件）沿 Result.err；其后的替换链（备份 → 关连接 → 覆盖 → 恢复三表）
      // 替换链（备份 → 关连接 → 覆盖 → 恢复三表）全走 Result（error-matrix-final R2）。
      const handle = await fsOps.open(srcPath, "r");
      let checked: Result<void, AppError>;
      try {
        const buf = Buffer.alloc(SQLITE_HEADER_BYTES);
        const { bytesRead } = await handle.read(buf, 0, SQLITE_HEADER_BYTES, 0);
        checked = SqliteBackupHeader.assert(new Uint8Array(buf.subarray(0, bytesRead)));
      } finally {
        await handle.close();
      }
      if (!checked.ok) return Result.err(checked.error);

      const liveConn = await DesktopDb.get();
      const providerSnapshot = await ProviderTableSnapshotIo.dump(liveConn);

      const replaced = await replaceLiveDatabase((dbPath) => fsOps.copyFile(srcPath, dbPath), providerSnapshot);
      if (!replaced.ok) return Result.err(replaced.error);
    } finally {
      maintenanceBusy.release();
    }
    return Result.ok({ databaseReplaced: true, providerTablesRestored: true });
  }

  /**
   * 从内存中的备份字节导入数据库（dump → close → replace → restore），无对话框与 rebootstrap。
   * 调用方须在 `databaseReplaced === true` 时执行 rebootstrap，再记账、最后放互斥令牌。
   *
   * ic-20：busy 为计数/令牌配对——同 {@link importFromPath}。
   */
  // nm-style: keep-local — db-backup-busy.test 直引断言字节导入的互斥令牌语义（3 个调用点）；内联会破坏测试锁名。
  export async function importFromBytes(bytes: Uint8Array): Promise<Result<DbImportOutcome, AppError>> {
    maintenanceBusy.acquire();
    try {
      // 内存态校验：bytes 已在堆上，不涉及整包读盘。失败沿 Result.err（同 FromPath 口径）。
      const checked = SqliteBackupHeader.assert(bytes);
      if (!checked.ok) return Result.err(checked.error);

      const liveConn = await DesktopDb.get();
      const providerSnapshot = await ProviderTableSnapshotIo.dump(liveConn);

      const replaced = await replaceLiveDatabase((dbPath) => writeFile(dbPath, bytes), providerSnapshot);
      if (!replaced.ok) return Result.err(replaced.error);
    } finally {
      maintenanceBusy.release();
    }
    return Result.ok({ databaseReplaced: true, providerTablesRestored: true });
  }

  /**
   * 只负责「Agent 守卫 + 原生保存对话框」：返回目标路径（用户取消返回 `null`）。
   *
   * 单独拆出是取消策略表的硬要求：备份导出的取消 scope **必须在对话框 resolve
   * 之后才创建**（对话框期间的 abort 不承诺生效），300s deadline 也只覆盖 copy 段。
   */
  export async function pickExportPath(parentWindow?: BrowserWindow | null): Promise<Result<string | null, AppError>> {
    if (agentActivity.isActive()) {
      return Result.err(new AppError("AGENT_BUSY", { detail: "Agent 运行中，请稍后再导出数据库" }));
    }

    const fileName = "nmbackup.db";
    const win = parentWindow ?? undefined;

    const dialogOptions: Electron.SaveDialogOptions = { defaultPath: fileName, filters: [{ name: "Novel Master Backup", extensions: ["db", "nmbackup"] }] };
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || result.filePath == null) {
      return Result.ok(null);
    }
    return Result.ok(result.filePath);
  }

  // nm-style: keep-local — db-backup-export-dialog.test 直引断言导出对话框编排（3 个调用点）；内联会破坏测试锁名。
  export async function exportWithDialog(runtime: DesktopNovelMasterRuntime, parentWindow?: BrowserWindow | null): Promise<Result<"saved" | "cancelled", AppError>> {
    const picked = await pickExportPath(parentWindow);
    if (!picked.ok) return Result.err(picked.error);
    if (picked.value == null) return Result.ok("cancelled");

    await exportToPath(runtime, picked.value);
    return Result.ok("saved");
  }

  export async function importWithDialog(parentWindow?: BrowserWindow | null): Promise<Result<"imported" | "cancelled", AppError>> {
    if (agentActivity.isActive()) {
      return Result.err(new AppError("AGENT_BUSY", { detail: "Agent 运行中，请稍后再导入数据库" }));
    }

    const win = parentWindow ?? undefined;
    const dialogOptions: Electron.OpenDialogOptions = { filters: [{ name: "Novel Master Backup", extensions: ["nmbackup", "db"] }], properties: ["openFile"] };
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return Result.ok("cancelled");
    }

    const pickedPath = result.filePaths[0]!;
    // 走路径级导入：整包 readFile 会把 200MB 级备份拉进 Node 堆，
    // 且与 mobile（pick 到本地路径 → FromPath）的形态不一致。
    // 返回类型不变（Result："imported" | "cancelled"），调用方 handlers/backup.ts 同步适配。
    const imported = await importFromPath(pickedPath);
    if (!imported.ok) return Result.err(imported.error);
    return Result.ok("imported");
  }
}
