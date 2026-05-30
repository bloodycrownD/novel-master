/**
 * Resolves Novel Master home directory (parent of `novel.db`).
 *
 * @module compaction/novel-master-home
 */

import { dirname, resolve } from "node:path";

/**
 * Returns the directory containing `novel.db` (e.g. `.novel-master/`).
 */
export function resolveNovelMasterHome(dbPath: string): string {
  if (process.env.NOVEL_MASTER_HOME) {
    return resolve(process.env.NOVEL_MASTER_HOME);
  }
  return resolve(dirname(dbPath));
}
