/**
 * Device-local VFS DB identity (separate from CLI `.novel-master/novel.db`).
 */

/** quick-sqlite logical database name in app private storage. */
export const MOBILE_VFS_DB_NAME = 'novel_master_vfs';

/** TDBC URL passed to {@link open} with the RN driver. */
export const MOBILE_TDBC_URL = `tdbc:sqlite:file:${MOBILE_VFS_DB_NAME}`;
