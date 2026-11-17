/**
 * 数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商三表）——双端单源。
 *
 * 平台差异全部经 {@link ExportDatabaseBackupDeps} 注入：WAL checkpoint（两端
 * connection 模块）、库路径解析（desktop 同步 / mobile 异步）、文件拷贝
 * （node copyFile / RN blobFs.cp）。busy 互斥的 acquire/release 配对留在各端壳里，
 * 本函数只覆盖「checkpoint → copy → scrub」这段策略。
 *
 * @module infra/db-backup/export-database-backup
 */

import type {Interrupt} from "@/errors/outcome.js";
import {createAbortError} from "@/domain/abort/logic/create-abort-error.js";
import type {TdbcConnection} from "../tdbc/ports/connection.port.js";
import {scrubProviderTablesInDatabase} from "./provider-table-snapshot.js";

/** scrub 导出副本时 ATTACH 的别名（两端逐字一致）。 */
const EXPORT_ATTACH_ALIAS = "export_db";

/** 导出链路的平台注入点。 */
type ExportDatabaseBackupDeps = {
    /** WAL checkpoint：desktop `checkpointDesktopDatabase` / mobile `checkpointMobileDatabase`。 */
    checkpointDatabase: (conn: TdbcConnection) => Promise<void>;
    /** 活动库路径解析：desktop `resolveDbPath`（同步）/ mobile `resolveMobileDatabaseFilePath`（异步）。 */
    resolveDbPath: () => string | Promise<string>;
    /** 库文件拷贝：desktop `node:fs/promises.copyFile` / mobile `blobFs().cp`。 */
    copyFile: (srcPath: string, destPath: string) => Promise<void>;
};

/**
 * 将数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商三表），无文件对话框。
 * 调用方负责 Agent 守卫、目标路径管理与 busy 互斥。
 *
 * 取消策略：copy 前调用 `checkpoint`，命中走 AbortError（平台协议例外：Promise
 * 无 Result 通道），由各端边界转 Outcome.cancelled / IPC_ABORTED。
 */
export async function exportDatabaseBackupToPath(conn: TdbcConnection, destPath: string, deps: ExportDatabaseBackupDeps, checkpoint?: () => Interrupt | null): Promise<void> {
    await deps.checkpointDatabase(conn);
    const dbPath = await deps.resolveDbPath();
    if (checkpoint?.() != null) {
        throw createAbortError();
    }
    await deps.copyFile(dbPath, destPath);
    await scrubProviderTablesInDatabase(conn, destPath, EXPORT_ATTACH_ALIAS);
}
