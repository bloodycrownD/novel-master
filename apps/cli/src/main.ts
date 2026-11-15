/**
 * Novel Master CLI entry (`nm`).
 *
 * @module main
 */

import { PACKAGE_NAME } from "@novel-master/core";


import { type VfsService } from "@novel-master/core/vfs";
import { type Outcome } from "@novel-master/core/workplace";
import { runPreferences } from "./preferences-cmd/commands.js";
import { runMessage } from "./message/commands.js";
import { runProject } from "./project/commands.js";
import { runProjectVfs } from "./project/vfs.js";
import { runVfsWorkplace } from "./vfs/workplace.js";
import { runPrompt } from "./prompt/commands.js";
import { runProvider } from "./provider/commands.js";
import { runModel } from "./model/commands.js";
import { runAgent } from "./agent/commands.js";
import { runCompactionConditions } from "./compaction-conditions/commands.js";
import { runSortRule } from "./sort-rule/commands.js";
import { runSession } from "./session/commands.js";
import { createNovelMasterRuntime } from "./runtime.js";
import {
  CANCELLED_MESSAGE,
  EXIT_CANCELLED,
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
import { runImportCharacterCard } from "./vfs/commands/import-character-card.js";
import { runImportZip } from "./vfs/commands/import-zip.js";
import { extractDbPath, parseCliArgs } from "./vfs/parse-args.js";
import { installCliLogSink } from "./log/cli-log-sink.js";
import { extractLogFilePath } from "./log/parse-log-file-arg.js";

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

  if (subcommand === "workplace") {
    const rt = await createNovelMasterRuntime(argv);
    try {
      const outcome = await runVfsWorkplace(rt, subArgs);
      if (outcome.kind === "cancelled" || outcome.kind === "replaced") {
        console.error(CANCELLED_MESSAGE);
        return EXIT_CANCELLED;
      }
      if (outcome.kind === "failed") throw outcome.error;
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
    if (subcommand === "import-character-card") {
      await runImportCharacterCard(rt.conn, { kind: "global" }, subArgs);
      return 0;
    }
    if (subcommand == null || !(subcommand in GLOBAL_VFS_COMMANDS)) {
      console.error(
        "Usage: novel-master vfs <list|read|write|replace|glob|grep|delete|mkdir|export-zip|import-zip|import-character-card|workplace> ...",
      );
      return EXIT_USAGE;
    }
    await GLOBAL_VFS_COMMANDS[subcommand]!(rt.globalVfs(), subArgs);
    return 0;
  } finally {
    await rt.conn.close();
  }
}

// nm-style: keep-public — CLI 进程入口（`src/index.ts` 唯一调用）；命令分发不是可内联的局部 helper。
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  // `--log-file` 是全局参数：先摘掉再分发，子命令的参数解析不该看到它。
  const { logFile, rest: args } = extractLogFilePath(argv);
  installCliLogSink({ logFile });
  const top = args[0];

  if (top === "config" || top === "kkv") {
    console.error(
      `Unknown command: ${top}. Use 'nm preferences' for settings; workspace pointers are set via project/session/provider/model use.`,
    );
    return EXIT_USAGE;
  }

  if (top === "vfs") {
    try {
      return await runVfs(args.slice(1));
    } catch (error) {
      const code = exitCodeForError(error);
      if (code === EXIT_CANCELLED) {
        console.error(CANCELLED_MESSAGE);
        return EXIT_CANCELLED;
      }
      console.error(formatCliError(error));
      return code;
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
    top === "sort-rule"
  ) {
    const rt = await createNovelMasterRuntime(args);
    try {
      const sub = args[1];
      const rest = args.slice(2);
      if (sub == null) {
        console.error(`Usage: novel-master ${top} <subcommand> ...`);
        return EXIT_USAGE;
      }
      // cancelled 管线（spec-3 §3.5）：产中断的命令链（prompt / session / project
      // 的 workplace display）沿 Outcome 交回本边界判；其余命令保持 void。
      // failed 同沿 Outcome 交回本边界，unwrap 汇入下方 catch 统一出口（错误通道迁移三期）。
      let outcome: Outcome<void> | undefined;
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
            outcome = await runProject(rt, sub, rest);
          }
          break;
        case "session":
          outcome = await runSession(rt, sub, rest);
          break;
        case "message":
          await runMessage(rt, sub, rest);
          break;
        case "prompt":
          outcome = await runPrompt(rt, sub, rest);
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
        case "sort-rule":
          await runSortRule(rt, sub, rest);
          break;
      }
      if (outcome != null) {
        if (outcome.kind === "cancelled" || outcome.kind === "replaced") {
          console.error(CANCELLED_MESSAGE);
          return EXIT_CANCELLED;
        }
        // 与 runVfs 边界同款：failed unwrap 后交给下方 catch（exitCodeForError + formatCliError）。
        if (outcome.kind === "failed") throw outcome.error;
      }
      return 0;
    } catch (error) {
      const code = exitCodeForError(error);
      if (code === EXIT_CANCELLED) {
        console.error(CANCELLED_MESSAGE);
        return EXIT_CANCELLED;
      }
      console.error(formatCliError(error));
      return code;
    } finally {
      await rt.conn.close();
    }
  }

  const name = args[0] ?? "world";
  console.log(`Hello, ${name} from ${PACKAGE_NAME}`);
  return 0;
}
