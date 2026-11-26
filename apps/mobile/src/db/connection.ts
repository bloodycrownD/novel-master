/**
 * Single SQLite connection for mobile (VFS + SKSP share one DB).
 */
import {AppState} from 'react-native';
import {NovelMasterBootstrap, TdbcOpen, type TdbcConnection} from '@novel-master/core';
import {OpSqliteNativeRegister} from '@novel-master/tdbc-driver-op-sqlite/native';
import {SkspAndroidRegister} from '@novel-master/sksp-android';
import {TokenizerRnRegister} from '@novel-master/tokenizer-driver-rn/native';
import {MOBILE_TDBC_URL} from '../vfs/constants';
import {MobileDatabaseFilePath} from './db-file-path';

/** 单例连接槽（模块内 holder，对象管理）：共享连接与初始化中的 Promise。 */
const connectionSlot = {
    conn: undefined as TdbcConnection | undefined,
    initPromise: undefined as Promise<TdbcConnection> | undefined,
};

export const MobileDb = {
    /**
   * 打印错误及其 cause 链（最多 5 层）：驱动层的 TdbcError 会把原始错误
   * （JSI 异常、路径不可写、disk I/O error 等）包在 cause 里，UI 只显示主文案。
   */
    logCauseChain: (label: string, err: unknown): void => {
        console.error(`[nm-boot] ${label} 失败:`, err);
        let cause: unknown = err instanceof Error ? err.cause : undefined;
        let depth = 0;
        while (cause && depth < 5) {
            console.error(`[nm-boot] ${label} cause[${depth}]:`, cause);
            cause = cause instanceof Error ? cause.cause : undefined;
            depth++;
        }
    },

    /**
   * 注册移动端 op-sqlite 驱动——移动端装配的**唯一入口**。
   *
   * 注入后台探测：RN 后台 JS 定时器停摆，事务内 setTimeout(0) 量子
   * 让步会让事务挂死到回前台；AppState.currentState 由原生生命周期
   * 驱动（不经 Choreographer），后台时驱动层跳过让步连续执行、回前台
   * 自动恢复。探测函数在 app 层注入，驱动包保持零依赖。
   *
   * 驱动注册表是 last-wins：任何其它地方再调一次无参的
   * `OpSqliteNativeRegister.register()` 都会把这里的带参版本覆盖掉、静默丢掉
   * 后台探测。因此 app 层所有需要打开 op-sqlite 连接的入口
   * （如 db-backup 的服务商表恢复短连接）都必须调本函数。
   */
    registerMobileOpSqliteDriver: (): void => {
        OpSqliteNativeRegister.register(undefined, () => AppState.currentState === 'background');
    },

    /** Opens (once) the app DB with core bootstrap and SKSP Android driver. */
    getMobileConnection: async (): Promise<TdbcConnection> => {
        if (connectionSlot.conn) {
            return connectionSlot.conn;
        }
        if (!connectionSlot.initPromise) {
            connectionSlot.initPromise = (async () => {
                MobileDb.registerMobileOpSqliteDriver();
                SkspAndroidRegister.register();
                TokenizerRnRegister.register();
                let c: TdbcConnection;
                try {
                    c = await TdbcOpen.open(MOBILE_TDBC_URL, {driver: 'op-sqlite'});
                } catch (openErr: unknown) {
                    MobileDb.logCauseChain('open', openErr);
                    // nm-throw: keep — TdbcOpen/op-sqlite 驱动的平台异常：catch 只补 cause 链日志后原样透传，失败通道由调用方（bootstrap catch / 备份回滚 catch）统一收口
                    throw openErr;
                }
                try {
                    await NovelMasterBootstrap.bootstrap(c);
                } catch (bootErr: unknown) {
                    MobileDb.logCauseChain('bootstrap', bootErr);
                    // 此时 connectionSlot.conn 还没赋值，MobileDb.closeMobileConnection() 里的 connectionSlot.conn?.close()
                    // 关不到这条连接；不在这里手动 close，局部变量 c 持有的已打开连接
                    // 会随 throw 一起丢弃，文件句柄和 WAL 锁随之泄漏——Android 上重试
                    // 重新 open 同一个库时，新旧连接可能互相锁死。close 本身失败不掩盖
                    // 原始的 bootstrap 错误，所以吞掉它的异常。
                    await c.close().catch(() => {});
                    // nm-throw: keep — NovelMasterBootstrap 的平台异常：catch 只补 cause 链日志并清完连接后原样透传，失败通道由调用方（bootstrap catch / 备份回滚 catch）统一收口
                    throw bootErr;
                }
                await MobileDatabaseFilePath.probeAndCache();
                connectionSlot.conn = c;
                return c;
            })();
        }
        return connectionSlot.initPromise;
    },

    /** Closes the shared connection and clears init state. */
    closeMobileConnection: async (): Promise<void> => {
        await connectionSlot.conn?.close();
        connectionSlot.conn = undefined;
        connectionSlot.initPromise = undefined;
        MobileDatabaseFilePath.clearCache();
    },

    /** WAL checkpoint before file-level copy (export backup). */
    checkpointMobileDatabase: async (connection: TdbcConnection): Promise<void> => {
        await connection.execute('PRAGMA wal_checkpoint(FULL)');
    },
} as const;
