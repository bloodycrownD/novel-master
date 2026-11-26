/**
 * 全量 SQLite 数据库导出/导入（文件级拷贝 + 服务商表隔离）。
 *
 * 大备份（数十～上百 MB）禁止整包读入 JS / base64 往返，导入统一走路径级 cp。
 *
 * 调用链契约（两端一致）：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
 * 导入函数只负责库面动作，并如实回报「库文件是否已被替换」
 * （{@link DbImportOutcome.databaseReplaced}）；调用方据此决定是否重建 runtime，
 * 记账必须排在重建之后，互斥令牌必须排在记账之后。
 *
 * @module services/db-backup.service
 */
import {Platform} from 'react-native';
import {types} from '@react-native-documents/picker';
import {DatabaseBackupExport, ProviderTableSnapshotIo, SqliteBackupHeader, TdbcOpen} from '@novel-master/core';
import type {Outcome} from '@novel-master/core/errors';
import {AppError} from '@novel-master/core/errors';
import {ABORT_KEY, AbortError, AbortScopeFactory} from '@novel-master/core/abort';
import {Result, type Interrupt} from '@novel-master/core/errors';
import {MobileDb} from '../db/connection';
import {MobileDatabaseFilePath} from '../db/db-file-path';
import {agentActivity} from '../runtime/agent-activity';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {MOBILE_TDBC_URL} from '../vfs/constants';
import {maintenanceBusy} from './db-maintenance-busy';
import {DocumentIo, type ExportViaPickerOptions} from './document-io';
import {RnFileIo} from './rn-file-io';

const BACKUP_EXT = '.nmbackup';
/** 分块落盘，避免 100MB+ Uint8Array → 单次 base64 撑爆 Hermes 堆。 */
const WRITE_CHUNK_BYTES = 256 * 1024;

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

export namespace DbBackupService {
    function errorDetail(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    /**
   * 将数据库导出到指定路径（checkpoint → 拷贝 → 清除服务商表），无分享对话框。
   * 调用方负责 Agent 守卫与目标路径管理；共享链路在 core（{@link DatabaseBackupExport.toPath}），
   * 本壳只保留 mobile 的 busy 计数与平台注入点（异步路径解析 / blobFs.cp）。
   *
   * busy 互斥在此底层置位（计数/令牌配对）：云同步等直调路径不经上层包装
   * 也能被覆盖，期间归一/压缩后台循环让路。
   */
    export async function exportToPath(runtime: MobileNovelMasterRuntime, destPath: string, checkpoint?: () => Interrupt | null): Promise<Outcome<void>> {
        maintenanceBusy.acquire();
        try {
            // return await（非裸 return）：async try-finally 里裸 return promise 的 finally 先于 settle 执行，release 会提前放行 busy。
            return await DatabaseBackupExport.toPath(runtime.conn, destPath, {checkpointDatabase: MobileDb.checkpointMobileDatabase, resolveDbPath: MobileDatabaseFilePath.resolve, copyFile: async (from, to) => { await RnFileIo.blobFs().cp(from, to); }}, checkpoint);
        } finally {
            maintenanceBusy.release();
        }
    }

    /**
   * 从本地快照文件导入数据库（dump → close → cp 替换 → restore），无选择器与 rebootstrap。
   * 调用方须在 `databaseReplaced === true` 时先重建 runtime，再记账、最后放互斥令牌。
   *
   * busy 互斥在此底层置位（计数/令牌配对）：「关连接 + 覆盖库文件」的
   * 最危险窗口与恢复三表全程覆盖，云同步直调路径同样被保护。
   *
   * 错误处理口径（与 desktop 同款）：
   * - 文件级校验（存在性 / 体积）为已知失败，沿 `Result.err` 上行（错误通道迁移五期）。
   * - 备份步裸 await，失败即抛（全新安装 dbPath 不存在时跳过，此时无可回滚）。
   * - 回滚只覆盖「覆盖动作本身失败」这一段；覆盖已成功后返回
   *   `DB_BACKUP_REPLACE_INCOMPLETE`，**不回滚**。
   * - 回滚失败**不得静默**：与原错误合并成一条可读信息，并保留 bak 副本
   *   （mobile 从不删 bak，用户还能手工救回）。
   */
    export async function importFromPath(srcPath: string): Promise<Result<DbImportOutcome, AppError>> {
        maintenanceBusy.acquire();
        try {
            // 仅校验路径存在且体积足够；魔数交给替换后 open（失败则 bak 回滚）。
            // 注意：`fs.readFile(path, enc, 16)` 的第三参会被忽略，会整包读入，大备份必 OOM。
            const backupFs = RnFileIo.blobFs();
            const srcExists = await backupFs.exists(srcPath);
            if (!srcExists) return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: `数据库文件不存在: ${srcPath}`}));
            const srcInfo = await backupFs.stat(srcPath);
            if (Number(srcInfo.size) < 16) return Result.err(new AppError('INFRA_VALIDATION_FAILED', {detail: '文件过小，不是有效的数据库备份'}));

            const dbPath = await MobileDatabaseFilePath.resolve();
            const bakPath = `${dbPath}.nmbackup.bak`;

            const liveConn = await MobileDb.getMobileConnection();
            const providerSnapshot = await ProviderTableSnapshotIo.dump(liveConn);

            const fs = RnFileIo.blobFs();
            const dbExists = await fs.exists(dbPath);
            let bakCreated = false;
            let databaseReplaced = false;
            if (dbExists) {
                await fs.cp(dbPath, bakPath);
                bakCreated = true;
            }

            try {
                await MobileDb.closeMobileConnection();
                await fs.cp(srcPath, dbPath);
                databaseReplaced = true;

                // 必须走 db/connection 的单点注册：驱动注册表是 last-wins，直接调
                // 无参的 registerOpSqliteDriver() 会把带后台探测的版本覆盖掉。
                // 短连接打开 live DB，仅用于导入后恢复本机服务商三表（不跑 bootstrap）。
                MobileDb.registerMobileOpSqliteDriver();
                const restoreConn = await TdbcOpen.open(MOBILE_TDBC_URL, {driver: 'op-sqlite'});
                try {
                    await ProviderTableSnapshotIo.restore(restoreConn, providerSnapshot);
                } finally {
                    await restoreConn.close();
                }
            } catch (error) {
                if (databaseReplaced) {
                    // 库已是新快照：不回滚，只把「已换代 + 三表未恢复」沿 DB_BACKUP_REPLACE_INCOMPLETE
                    // 如实报上去（error-matrix-final R2：异常哨兵 DatabaseReplacedError 退役，
                    // providerTablesRestored 进 details；调用方判 key 后重建 runtime）。
                    const recoveryHint = bakCreated ? `导入前的旧库副本已保留在 ${bakPath}（未回滚，需要时可手工替换回来）。` : '';
                    // cause 必须走第三参 options（塞 params 会被 firstDescriptorOf 误认成 descriptor，
                    // 污染 messageKey——desktop 同款教训）。
                    return Result.err(new AppError('DB_BACKUP_REPLACE_INCOMPLETE', {detail: `数据库已导入，但本机服务商配置恢复失败：${errorDetail(error)}${recoveryHint}`, reason: errorDetail(error), recoveryHint, providerTablesRestored: false}, {cause: error}));
                }

                // 覆盖动作本身失败：库仍是旧库（或根本没换），回滚到备份。
                let rollbackError: unknown;
                if (bakCreated && (await fs.exists(bakPath))) {
                    try {
                        await fs.cp(bakPath, dbPath);
                    } catch (e) {
                        rollbackError = e;
                    }
                }
                if (rollbackError != null) {
                    const rollbackFailureDetail = `数据库导入失败且回滚失败，回滚副本保留在 ${bakPath}：${errorDetail(rollbackError)}（原始错误：${errorDetail(error)}）`;
                    return Result.err(new AppError('INFRA_UNEXPECTED_ERROR', {detail: rollbackFailureDetail}, {cause: [error, rollbackError]}));
                }
                // 覆盖动作失败但回滚已成功（库已恢复旧态）：转 Result 是对现状的诚实标记
                // （error-matrix-final §一.2）。
                return Result.err(error instanceof AppError ? error : new AppError('INFRA_UNEXPECTED_ERROR', {detail: `数据库导入失败（已回滚到导入前状态）：${errorDetail(error)}`}, {cause: error}));
            }
        } finally {
            maintenanceBusy.release();
        }
        return Result.ok({databaseReplaced: true, providerTablesRestored: true});
    }

    /**
   * 从内存中的备份字节导入：先分块落盘再走路径级 cp（禁止整包 base64 writeFile）。
   * 调用方须在 `databaseReplaced === true` 时先重建 runtime，再记账、最后放互斥令牌。
   *
   * busy 互斥由内部 `importFromPath` 的底层 acquire/release
   * 覆盖（含落盘窗口），本函数无需再叠加。
   */
    // nm-style: keep-public — db-backup.service.test.ts / cloud-sync.service.test.ts 直接 import 断言（pull 链路集成），测试锁名
    export async function importFromBytes(bytes: Uint8Array): Promise<Result<DbImportOutcome, AppError>> {
        // 内存态校验（魔数 + 体积，与 desktop 同源）：失败沿 Result.err（与 FromPath 同口径）。
        const checked = SqliteBackupHeader.assert(bytes);
        if (!checked.ok) return Result.err(checked.error);

        const fs = RnFileIo.blobFs();
        const tmpPath = `${fs.dirs.CacheDir}/import-bytes-${Date.now()}${BACKUP_EXT}`;
        try {
            // 分块 ascii 写入，避免整包 `String.fromCharCode` / `btoa`。
            const stream = await RnFileIo.blobFs().writeStream(tmpPath, 'ascii', false);
            try {
                for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
                    const end = Math.min(offset + WRITE_CHUNK_BYTES, bytes.length);
                    const slice = bytes.subarray(offset, end);
                    await stream.write(RnFileIo.bytesToAsciiString(slice));
                }
            } finally {
                await stream.close();
            }
            // 委托 FromPath：DbImportOutcome 必须原样透传（含 DB_BACKUP_REPLACE_INCOMPLETE 的
            // 类型），漏了这一层委托就拿不到「已换代」信号。
            return await importFromPath(tmpPath);
        } finally {
            await fs.unlink(tmpPath).catch(() => undefined);
        }
    }

    /**
   * 导出全量应用数据库为可分享的 `.nmbackup` 文件（副本不含服务商表）。
   * @returns `'saved'` 用户完成分享；`'cancelled'` 用户取消选择器。
   */
    // nm-style: keep-public — db-backup.service.test.ts 直接 import 断言；storage-config-cancel 测试经它驱动
    export async function exportViaPicker(runtime: MobileNovelMasterRuntime): Promise<Result<'saved' | 'cancelled', AppError>> {
        if (agentActivity.isActive()) {
            return Result.err(new AppError('AGENT_BUSY', {detail: 'Agent 运行中，请稍后再导出数据库'}));
        }

        // 任务级取消 scope（spec §五移动表：backup("local")，入口 + copyFile 前）。
        // 取消沿返回值上行（Result.ok('cancelled')）；选择器/平台 IO write 回调内的取消仍 throw AbortError（DocumentIo 契约无控制流通道）。
        const abortScope = AbortScopeFactory.create();
        runtime.abortRegistry.register(ABORT_KEY.backup('local'), abortScope);
        try {
            if (abortScope.checkpoint() != null) {
                return Result.ok('cancelled');
            }
            // 外层 acquire（计数配对，不是幂等空操作）：把选择器弹出窗口也纳入
            // 互斥——底层 exportToPath 内部另有一层自平衡的
            // acquire/release，嵌套计数不会互相提前清位。
            maintenanceBusy.acquire();
            try {
                const exportOptions: ExportViaPickerOptions = {
                    fileName: 'nmbackup.db',
                    mimeType: 'application/octet-stream',
                    copy: Platform.OS === 'ios',
                    write: destPath => exportToPath(runtime, destPath, () => abortScope.checkpoint()).then(outcome => {
                        if (outcome.kind !== 'completed') throw AbortError.create(); // nm-throw: keep — 平台强制——DocumentIo.write 契约无控制流通道，调用方 catch isAbortLikeError 收编
                    }),
                };
                const saved = await DocumentIo.exportBytes(exportOptions);
                return Result.ok(saved);
            } finally {
                maintenanceBusy.release();
            }
        } finally {
            runtime.abortRegistry.unregister(ABORT_KEY.backup('local'), abortScope);
            abortScope.dispose();
        }
    }

    /**
   * 用所选备份文件替换应用数据库；本机服务商三表在替换后写回。
   * 大文件仅 keepLocalCopy + 路径级 cp，不读入 JS 堆。
   * 调用方须在成功后执行 `onRebootstrap`（例如 NovelMasterProvider.retry）。
   */
    export async function importViaPicker(runtime: MobileNovelMasterRuntime, onRebootstrap: () => void): Promise<Result<'reloaded' | 'cancelled', AppError>> {
        if (agentActivity.isActive()) {
            return Result.err(new AppError('AGENT_BUSY', {detail: 'Agent 运行中，请稍后再导入数据库'}));
        }

        // 任务级取消 scope（spec §五移动表：backup("local")，**仅入口**）。
        // `close → cp → restore` 整段不可中断，禁止 race 早 settle。
        const abortScope = AbortScopeFactory.create();
        runtime.abortRegistry.register(ABORT_KEY.backup('local'), abortScope);
        try {
            if (abortScope.checkpoint() != null) {
                return Result.ok('cancelled');
            }
            // 外层 acquire（计数配对）：把选择器窗口到 rebootstrap 完成的完整
            // 链路纳入互斥——底层 importFromPath 内部的
            // acquire/release 只覆盖到它自己返回，库文件已替换、连接仍处重建窗口
            // 的尾段由这层兜住。release 放 finally 且 onRebootstrap 在 try 内最后
            // 一步执行，故清位必然发生在 rebootstrap 完成之后。
            maintenanceBusy.acquire();
            try {
                const picked = await DocumentIo.pickToLocalPath({mimeTypes: [types.allFiles], localFileName: 'import.nmbackup'});
                if (picked == null) {
                    return Result.ok('reloaded');
                }

                const imported = await importFromPath(picked.fsPath);
                if (!imported.ok) return Result.err(imported.error);
                onRebootstrap();
                return Result.ok('reloaded');
            } finally {
                maintenanceBusy.release();
            }
        } finally {
            runtime.abortRegistry.unregister(ABORT_KEY.backup('local'), abortScope);
            abortScope.dispose();
        }
    }
}
