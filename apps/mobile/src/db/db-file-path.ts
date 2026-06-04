/**
 * On-disk path for the mobile VFS SQLite file (aligned with quick-sqlite layout).
 *
 * @module db/db-file-path
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {MOBILE_VFS_DB_NAME} from '../vfs/constants';

/** Subfolder under app files dir used by quick-sqlite when `location: 'default'`. */
export const QUICK_SQLITE_DEFAULT_LOCATION = 'default';

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
  const base = dirs.DocumentDir ?? dirs.LibraryDir ?? dirs.ApplicationSupportDir;
  if (typeof base !== 'string' || base.length === 0) {
    throw new Error('无法定位应用数据库目录');
  }
  return base;
}

/** Paths quick-sqlite may use for `novel_master_vfs` (newest layout first). */
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
