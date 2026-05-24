/**
 * VFS CLI runtime (global scoped); delegates to {@link createNovelMasterRuntime}.
 *
 * @module vfs/runtime
 */

import type { TdbcConnection, VfsService } from "@novel-master/core";
import { createNovelMasterRuntime } from "../runtime.js";

export { resolveDbPath } from "../runtime.js";

/**
 * Opens DB, bootstraps schema, returns global scoped {@link VfsService}.
 */
export async function createVfsRuntime(argv: readonly string[]): Promise<{
  vfs: VfsService;
  conn: TdbcConnection;
}> {
  const rt = await createNovelMasterRuntime(argv);
  return { vfs: rt.globalVfs(), conn: rt.conn };
}
