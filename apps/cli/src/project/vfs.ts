/**
 * `nm project vfs` subcommands.
 *
 * @module project/vfs
 */

import { type TdbcConnection } from "@novel-master/core";

import { type VfsService } from "@novel-master/core/vfs";
import { type AppError, type Result } from "@novel-master/core/errors";
import { runDelete } from "../vfs/commands/delete.js";
import { runExportZip } from "../vfs/commands/export-zip.js";
import { runImportCharacterCard } from "../vfs/commands/import-character-card.js";
import { runImportZip } from "../vfs/commands/import-zip.js";
import { runGlob } from "../vfs/commands/glob.js";
import { runGrep } from "../vfs/commands/grep.js";
import { runList } from "../vfs/commands/list.js";
import { runMkdir } from "../vfs/commands/mkdir.js";
import { runRead } from "../vfs/commands/read.js";
import { runReplace } from "../vfs/commands/replace.js";
import { runWrite } from "../vfs/commands/write.js";
import { parseCliArgs } from "../vfs/parse-args.js";

const PROJECT_VFS_COMMANDS: Record<string, (vfs: VfsService, args: readonly string[]) => Promise<Result<void, AppError>>> = {
  list: runList,
  mkdir: runMkdir,
  read: runRead,
  write: runWrite,
  replace: runReplace,
  glob: runGlob,
  grep: runGrep,
  delete: runDelete,
};

/**
 * vfs 子命令的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
export async function runProjectVfs(conn: TdbcConnection, projectVfs: (projectId: string) => VfsService, projectId: string, args: readonly string[]): Promise<Result<void, AppError>> {
  const vfsRest = args[0] === "vfs" ? args.slice(1) : args;
  const { positional } = parseCliArgs(vfsRest);
  const sub = positional[0];
  if (sub === "export-zip") {
    const idx = vfsRest.indexOf(sub);
    return runExportZip(conn, { kind: "project", projectId }, vfsRest.slice(idx + 1));
  }
  if (sub === "import-zip") {
    const idx = vfsRest.indexOf(sub);
    return runImportZip(conn, { kind: "project", projectId }, vfsRest.slice(idx + 1));
  }
  if (sub === "import-character-card") {
    const idx = vfsRest.indexOf(sub);
    return runImportCharacterCard(conn, { kind: "project", projectId }, vfsRest.slice(idx + 1));
  }
  if (sub == null || !(sub in PROJECT_VFS_COMMANDS)) {
    throw new Error("Usage: nm project vfs <list|read|write|replace|glob|grep|delete|mkdir|export-zip|import-zip|import-character-card> ...");
  }
  const vfs = projectVfs(projectId);
  const idx = vfsRest.indexOf(sub);
  return PROJECT_VFS_COMMANDS[sub]!(vfs, vfsRest.slice(idx + 1));
}
