/**
 * On-disk path for the mobile VFS SQLite file (quick-sqlite 旧布局 + op-sqlite 默认布局).
 *
 * @module db/db-file-path
 */
import type ReactNativeBlobUtil from 'react-native-blob-util';
import {RnFileIo} from '@/services/rn-file-io';
import {MOBILE_VFS_DB_NAME} from '@/vfs/constants';

/** Subfolder under app files dir used by quick-sqlite when `location: 'default'`. */
export const QUICK_SQLITE_DEFAULT_LOCATION = 'default';

/**
 * op-sqlite Android 默认库目录：`Context.getDatabasePath()` 指向的 databases
 * 目录，也就是 files 目录（react-native-blob-util 的 DocumentDir）的兄弟目录。
 * iOS 默认落在 DocumentDir 根部，已被 `base/name` 候选覆盖，无需额外推导。
 */
/** 已探测到的真实库文件路径缓存（模块内 holder，对象管理；undefined = 未探测）。 */
const dbFilePathCache = {
  path: undefined as string | undefined,
};

/**
 * `novel_master_vfs` 库文件的磁盘路径（备份拷贝与缓存收口）。
 *
 * 候选路径 quick-sqlite 旧布局排在前面：驱动层 open 时对旧布局绝对路径优先探测，
 * 这里保持同样的优先级，保证备份拷贝的目标与驱动实际打开的文件一致。
 * op-sqlite 默认布局（Android databases 目录，文件名不带 `.db` 后缀）追加在后；
 * `.db` 变体一并保留，兜底真机 `getDbPath()` 核对前的不确定性。
 */
export const MobileDatabaseFilePath = {
  /**
   * Candidate paths for `novel_master_vfs` across driver layouts.
   */
  buildCandidates: (dirs: typeof ReactNativeBlobUtil.fs.dirs = RnFileIo.blobFs().dirs): string[] => {
    const dirsWithSupport = dirs as typeof dirs & {ApplicationSupportDir?: string};
    const base = dirs.DocumentDir ?? dirs.LibraryDir ?? dirsWithSupport.ApplicationSupportDir;
    if (typeof base !== 'string' || base.length === 0) {
      // nm-throw: keep — 平台边界：设备未返回可用的数据库根目录，同步路径解析无失败位
      throw new Error('无法定位应用数据库目录');
    }
    const fileNames = [MOBILE_VFS_DB_NAME, `${MOBILE_VFS_DB_NAME}.db`];
    const paths: string[] = [];
    for (const name of fileNames) {
      paths.push(`${base}/${QUICK_SQLITE_DEFAULT_LOCATION}/${name}`);
      paths.push(`${base}/${name}`);
    }
    const opSqliteBase = base.endsWith('/files') ? `${base.slice(0, -'/files'.length)}/databases` : undefined;
    if (opSqliteBase != null) {
      for (const name of fileNames) {
        paths.push(`${opSqliteBase}/${name}`);
      }
    }
    return paths;
  },

  default: (): string => MobileDatabaseFilePath.buildCandidates()[0]!,

  /**
   * Probes the filesystem after the DB is open and caches the real file path.
   * Call from {@link getMobileConnection} bootstrap.
   */
  probeAndCache: async (): Promise<string> => {
    const fs = RnFileIo.blobFs();
    for (const candidate of MobileDatabaseFilePath.buildCandidates(fs.dirs)) {
      if (await fs.exists(candidate)) {
        dbFilePathCache.path = candidate;
        return candidate;
      }
    }
    const fallback = MobileDatabaseFilePath.default();
    dbFilePathCache.path = fallback;
    return fallback;
  },

  /** Clears cached path (tests / after import replaces file at same location). */
  clearCache: (): void => {
    dbFilePathCache.path = undefined;
  },

  /**
   * Returns the SQLite file path for backup copy.
   * Prefer {@link MobileDatabaseFilePath.probeAndCache} after runtime bootstrap.
   */
  get: (): string => {
    if (dbFilePathCache.path != null) {
      return dbFilePathCache.path;
    }
    return MobileDatabaseFilePath.default();
  },

  /** Resolves path when cache is cold; probes disk if needed. */
  resolve: async (): Promise<string> => {
    if (dbFilePathCache.path != null) {
      return dbFilePathCache.path;
    }
    return MobileDatabaseFilePath.probeAndCache();
  },
} as const;
