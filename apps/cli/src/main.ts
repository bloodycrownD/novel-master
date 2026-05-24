/**
 * Novel Master CLI entry (`nm`).
 *
 * @module main
 */

import { greet, type VfsService } from "@novel-master/core";
import { runKkv } from "./kkv/commands.js";
import { runMessage } from "./message/commands.js";
import { runProject } from "./project/commands.js";
import { runProjectVfs } from "./project/vfs.js";
import { runSession } from "./session/commands.js";
import { createNovelMasterRuntime } from "./runtime.js";
import {
  EXIT_USAGE,
  exitCodeForError,
  formatCliError,
} from "./cli-errors.js";
import { runDelete } from "./vfs/commands/delete.js";
import { runGlob } from "./vfs/commands/glob.js";
import { runGrep } from "./vfs/commands/grep.js";
import { runList } from "./vfs/commands/list.js";
import { runRead } from "./vfs/commands/read.js";
import { runReplace } from "./vfs/commands/replace.js";
import { runWrite } from "./vfs/commands/write.js";
import { extractDbPath, parseCliArgs } from "./vfs/parse-args.js";

const GLOBAL_VFS_COMMANDS: Record<
  string,
  (vfs: VfsService, args: readonly string[]) => Promise<void>
> = {
  list: runList,
  read: runRead,
  write: runWrite,
  replace: runReplace,
  glob: runGlob,
  grep: runGrep,
  delete: runDelete,
};

async function runVfs(argv: string[]): Promise<number> {
  const { rest } = extractDbPath(argv);
  const subcommand = rest[0];
  const subArgs = rest.slice(1);

  if (subcommand == null || !(subcommand in GLOBAL_VFS_COMMANDS)) {
    console.error(
      "Usage: novel-master vfs <list|read|write|replace|glob|grep|delete> ...",
    );
    return EXIT_USAGE;
  }

  const rt = await createNovelMasterRuntime(argv);
  try {
    await GLOBAL_VFS_COMMANDS[subcommand]!(rt.globalVfs(), subArgs);
    return 0;
  } finally {
    await rt.conn.close();
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const top = argv[0];

  if (top === "vfs") {
    try {
      return await runVfs(argv.slice(1));
    } catch (error) {
      console.error(formatCliError(error));
      return exitCodeForError(error);
    }
  }

  if (
    top === "kkv" ||
    top === "project" ||
    top === "session" ||
    top === "message"
  ) {
    const rt = await createNovelMasterRuntime(argv);
    try {
      const sub = argv[1];
      const rest = argv.slice(2);
      if (sub == null) {
        console.error(`Usage: novel-master ${top} <subcommand> ...`);
        return EXIT_USAGE;
      }
      switch (top) {
        case "kkv":
          await runKkv(rt.kkv, sub, rest);
          break;
        case "project":
          if (sub === "vfs") {
            const { flags } = parseCliArgs(rest);
            const projectId = rt.scope.resolveProjectId(flags);
            await runProjectVfs(
              (id) => rt.projectVfs(id),
              projectId,
              rest,
            );
          } else {
            await runProject(rt, sub, rest);
          }
          break;
        case "session":
          await runSession(rt, sub, rest);
          break;
        case "message":
          await runMessage(rt, sub, rest);
          break;
      }
      return 0;
    } catch (error) {
      console.error(formatCliError(error));
      return exitCodeForError(error);
    } finally {
      await rt.conn.close();
    }
  }

  const name = argv[0] ?? "world";
  console.log(greet(name));
  return 0;
}
