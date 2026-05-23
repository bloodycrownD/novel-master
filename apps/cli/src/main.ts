import { greet } from "@novel-master/core";
import { runDelete } from "./vfs/commands/delete.js";
import { runGlob } from "./vfs/commands/glob.js";
import { runGrep } from "./vfs/commands/grep.js";
import { runList } from "./vfs/commands/list.js";
import { runRead } from "./vfs/commands/read.js";
import { runReplace } from "./vfs/commands/replace.js";
import { runWrite } from "./vfs/commands/write.js";
import {
  EXIT_USAGE,
  exitCodeForError,
  formatCliError,
} from "./vfs/errors.js";
import { extractDbPath } from "./vfs/parse-args.js";
import { createVfsRuntime } from "./vfs/runtime.js";

const VFS_COMMANDS: Record<
  string,
  (vfs: Awaited<ReturnType<typeof createVfsRuntime>>["vfs"], args: string[]) => Promise<void>
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

  if (subcommand == null || !(subcommand in VFS_COMMANDS)) {
    console.error(
      "Usage: novel-master vfs <list|read|write|replace|glob|grep|delete> ...",
    );
    return EXIT_USAGE;
  }

  const { vfs, conn } = await createVfsRuntime(argv);
  try {
    await VFS_COMMANDS[subcommand]!(vfs, subArgs);
    return 0;
  } finally {
    await conn.close();
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv[0] === "vfs") {
    try {
      return await runVfs(argv.slice(1));
    } catch (error) {
      console.error(formatCliError(error));
      return exitCodeForError(error);
    }
  }

  const name = argv[0] ?? "world";
  console.log(greet(name));
  return 0;
}
