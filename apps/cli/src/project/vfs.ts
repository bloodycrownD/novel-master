/**
 * `nm project vfs` subcommands.
 *
 * @module project/vfs
 */

import { type TdbcConnection } from "@novel-master/core";


import { type VfsService } from "@novel-master/core/vfs";
import { runDelete } from "../vfs/commands/delete.js";
import { runExportZip } from "../vfs/commands/export-zip.js";
import { runImportZip } from "../vfs/commands/import-zip.js";
import { runGlob } from "../vfs/commands/glob.js";
import { runGrep } from "../vfs/commands/grep.js";
import { runList } from "../vfs/commands/list.js";
import { runMkdir } from "../vfs/commands/mkdir.js";
import { runRead } from "../vfs/commands/read.js";
import { runReplace } from "../vfs/commands/replace.js";
import { runWrite } from "../vfs/commands/write.js";
import { parseCliArgs } from "../vfs/parse-args.js";

const PROJECT_VFS_COMMANDS: Record<
  string,
  (vfs: VfsService, args: readonly string[]) => Promise<void>
> = {
  list: runList,
  mkdir: runMkdir,
  read: runRead,
  write: runWrite,
  replace: runReplace,
  glob: runGlob,
  grep: runGrep,
  delete: runDelete,
};

export async function runProjectVfs(
  conn: TdbcConnection,
  projectVfs: (projectId: string) => VfsService,
  projectId: string,
  args: readonly string[],
): Promise<void> {
  const vfsRest = args[0] === "vfs" ? args.slice(1) : args;
  const { positional } = parseCliArgs(vfsRest);
  const sub = positional[0];
  if (sub === "export-zip") {
    const idx = vfsRest.indexOf(sub);
    await runExportZip(
      conn,
      { kind: "project", projectId },
      vfsRest.slice(idx + 1),
    );
    return;
  }
  if (sub === "import-zip") {
    const idx = vfsRest.indexOf(sub);
    await runImportZip(
      conn,
      { kind: "project", projectId },
      vfsRest.slice(idx + 1),
    );
    return;
  }
  if (sub == null || !(sub in PROJECT_VFS_COMMANDS)) {
    throw new Error(
      "Usage: nm project vfs <list|read|write|replace|glob|grep|delete|mkdir|export-zip|import-zip> ...",
    );
  }
  const vfs = projectVfs(projectId);
  const idx = vfsRest.indexOf(sub);
  await PROJECT_VFS_COMMANDS[sub]!(vfs, vfsRest.slice(idx + 1));
}
