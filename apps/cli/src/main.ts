/**
 * Novel Master CLI entry (`nm`).
 *
 * @module main
 */

import { greet, type VfsService } from "@novel-master/core";
import { runPreferences } from "./preferences-cmd/commands.js";
import { runMessage } from "./message/commands.js";
import { runProject } from "./project/commands.js";
import { runProjectVfs } from "./project/vfs.js";
import { runVfsWorktree } from "./vfs/worktree.js";
import { runPrompt } from "./prompt/commands.js";
import { runProvider } from "./provider/commands.js";
import { runModel } from "./model/commands.js";
import { runAgent } from "./agent/commands.js";
import { runCompactionConditions } from "./compaction-conditions/commands.js";
import { runEvents } from "./events/commands.js";
import { runEvent } from "./event/commands.js";
import { runRegexGroup } from "./regex-group/commands.js";
import { runRegex } from "./regex/commands.js";
import { runSession } from "./session/commands.js";
import { createNovelMasterRuntime } from "./runtime.js";
import {
  EXIT_USAGE,
  exitCodeForError,
  formatCliError,
} from "./cli-errors.js";
import { runDelete } from "./vfs/commands/delete.js";
import { runMkdir } from "./vfs/commands/mkdir.js";
import { runGlob } from "./vfs/commands/glob.js";
import { runGrep } from "./vfs/commands/grep.js";
import { runList } from "./vfs/commands/list.js";
import { runRead } from "./vfs/commands/read.js";
import { runReplace } from "./vfs/commands/replace.js";
import { runWrite } from "./vfs/commands/write.js";
import { runExportZip } from "./vfs/commands/export-zip.js";
import { runImportZip } from "./vfs/commands/import-zip.js";
import { extractDbPath, parseCliArgs } from "./vfs/parse-args.js";

const GLOBAL_VFS_COMMANDS: Record<
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

async function runVfs(argv: string[]): Promise<number> {
  const { rest } = extractDbPath(argv);
  const subcommand = rest[0];
  const subArgs = rest.slice(1);

  if (subcommand === "worktree") {
    const rt = await createNovelMasterRuntime(argv);
    try {
      await runVfsWorktree(rt, subArgs);
      return 0;
    } finally {
      await rt.conn.close();
    }
  }

  const rt = await createNovelMasterRuntime(argv);
  try {
    if (subcommand === "export-zip") {
      await runExportZip(rt.conn, { kind: "global" }, subArgs);
      return 0;
    }
    if (subcommand === "import-zip") {
      await runImportZip(rt.conn, { kind: "global" }, subArgs);
      return 0;
    }
    if (subcommand == null || !(subcommand in GLOBAL_VFS_COMMANDS)) {
      console.error(
        "Usage: novel-master vfs <list|read|write|replace|glob|grep|delete|mkdir|export-zip|import-zip|worktree> ...",
      );
      return EXIT_USAGE;
    }
    await GLOBAL_VFS_COMMANDS[subcommand]!(rt.globalVfs(), subArgs);
    return 0;
  } finally {
    await rt.conn.close();
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const top = argv[0];

  if (top === "config" || top === "kkv") {
    console.error(
      `Unknown command: ${top}. Use 'nm preferences' for settings; workspace pointers are set via project/session/provider/model use.`,
    );
    return EXIT_USAGE;
  }

  if (top === "vfs") {
    try {
      return await runVfs(argv.slice(1));
    } catch (error) {
      console.error(formatCliError(error));
      return exitCodeForError(error);
    }
  }

  if (
    top === "preferences" ||
    top === "project" ||
    top === "session" ||
    top === "message" ||
    top === "prompt" ||
    top === "provider" ||
    top === "model" ||
    top === "agent" ||
    top === "compaction-conditions" ||
    top === "events" ||
    top === "event" ||
    top === "regex-group" ||
    top === "regex"
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
        case "preferences":
          await runPreferences(rt.preferences, sub, rest);
          break;
        case "project":
          if (sub === "vfs") {
            const { flags } = parseCliArgs(rest);
            const projectId = await rt.scope.resolveProjectId(flags);
            await runProjectVfs(
              rt.conn,
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
        case "prompt":
          await runPrompt(rt, sub, rest);
          break;
        case "provider":
          await runProvider(rt, sub, rest);
          break;
        case "model":
          await runModel(rt, sub, rest);
          break;
        case "agent":
          await runAgent(rt, sub, rest);
          break;
        case "compaction-conditions":
          await runCompactionConditions(rt, sub, rest);
          break;
        case "events":
          await runEvents(rt, sub, rest);
          break;
        case "event":
          await runEvent(rt, sub, rest);
          break;
        case "regex-group":
          await runRegexGroup(rt, sub, rest);
          break;
        case "regex":
          await runRegex(rt, sub, rest);
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
