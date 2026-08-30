/**
 * On-disk path for the mobile VFS SQLite file (quick-sqlite 旧布局 + op-sqlite 默认布局).
 *
 * @module db/db-file-path
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {MOBILE_VFS_DB_NAME} from '@/vfs/constants';

/** Subfolder under app files dir used by quick-sqlite when `location: 'default'`. */
export const QUICK_SQLITE_DEFAULT_LOCATION = 'default';

/**
 * op-sqlite Android 默认库目录：`Context.getDatabasePath()` 指向的 databases
 * 目录，也就是 files 目录（react-native-blob-util 的 DocumentDir）的兄弟目录。
 * iOS 默认落在 DocumentDir 根部，已被 `base/name` 候选覆盖，无需额外推导。
 */
function opSqliteAndroidDatabasesDir(base: string): string | undefined {
  if (!base.endsWith('/files')) {
    return undefined;
  }
  return `${base.slice(0, -'/files'.length)}/databases`;
}

let cachedDbFilePath: string | undefined;

function blobFs(): typeof ReactNativeBlobUtil.fs {
  const anyMod = ReactNativeBlobUtil as unknown as {
    fs?: typeof ReactNativeBlobUtil.fs;
    default?: {fs?: typeof ReactNativeBlobUtil.fs};
  };
  const fs = anyMod.fs ?? anyMod.default?.fs;
  if (fs == null) {
    throw new Error('react-native-blob-util.fs unavailable');
  }
  return fs;
}

function defaultQuickSqliteBaseDir(
  dirs: typeof ReactNativeBlobUtil.fs.dirs,
): string {
  const dirsWithSupport = dirs as typeof dirs & {
    ApplicationSupportDir?: string;
  };
  const base =
    dirs.DocumentDir ??
    dirs.LibraryDir ??
    dirsWithSupport.ApplicationSupportDir;
  if (typeof base !== 'string' || base.length === 0) {
    throw new Error('无法定位应用数据库目录');
  }
  return base;
}

/**
 * Candidate paths for `novel_master_vfs` across driver layouts.
 *
 * quick-sqlite 旧布局排在前面：驱动层 open 时对旧布局绝对路径优先探测，
 * 这里保持同样的优先级，保证备份拷贝的目标与驱动实际打开的文件一致。
 * op-sqlite 默认布局（Android databases 目录，文件名不带 `.db` 后缀）追加在后；
 * `.db` 变体一并保留，兜底真机 `getDbPath()` 核对前的不确定性。
 */
export function buildMobileDatabaseFilePathCandidates(
  dirs: typeof ReactNativeBlobUtil.fs.dirs = blobFs().dirs,
): string[] {
  const base = defaultQuickSqliteBaseDir(dirs);
  const fileNames = [MOBILE_VFS_DB_NAME, `${MOBILE_VFS_DB_NAME}.db`];
  const paths: string[] = [];
  for (const name of fileNames) {
    paths.push(`${base}/${QUICK_SQLITE_DEFAULT_LOCATION}/${name}`);
    paths.push(`${base}/${name}`);
  }
  const opSqliteBase = opSqliteAndroidDatabasesDir(base);
  if (opSqliteBase != null) {
    for (const name of fileNames) {
      paths.push(`${opSqliteBase}/${name}`);
    }
  }
  return paths;
}

function defaultMobileDatabaseFilePath(): string {
  return buildMobileDatabaseFilePathCandidates()[0]!;
}

/**
 * Probes the filesystem after the DB is open and caches the real file path.
 * Call from {@link getMobileConnection} bootstrap.
 */
export async function probeAndCacheMobileDatabaseFilePath(): Promise<string> {
  const fs = blobFs();
  for (const candidate of buildMobileDatabaseFilePathCandidates(fs.dirs)) {
    if (await fs.exists(candidate)) {
      cachedDbFilePath = candidate;
      return candidate;
    }
  }
  const fallback = defaultMobileDatabaseFilePath();
  cachedDbFilePath = fallback;
  return fallback;
}

/** Clears cached path (tests / after import replaces file at same location). */
export function clearMobileDatabaseFilePathCache(): void {
  cachedDbFilePath = undefined;
}

/**
 * Returns the SQLite file path for backup copy.
 * Prefer {@link probeAndCacheMobileDatabaseFilePath} after runtime bootstrap.
 */
export function getMobileDatabaseFilePath(): string {
  if (cachedDbFilePath != null) {
    return cachedDbFilePath;
  }
  return defaultMobileDatabaseFilePath();
}

/** Resolves path when cache is cold; probes disk if needed. */
export async function resolveMobileDatabaseFilePath(): Promise<string> {
  if (cachedDbFilePath != null) {
    return cachedDbFilePath;
  }
  return probeAndCacheMobileDatabaseFilePath();
}
