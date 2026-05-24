/**
 * `nm session` subcommands.
 *
 * @module session/commands
 */

import type {
  SessionFsService,
  SessionService,
  VfsService,
} from "@novel-master/core";
import { runDelete } from "../vfs/commands/delete.js";
import { runGlob } from "../vfs/commands/glob.js";
import { runGrep } from "../vfs/commands/grep.js";
import { runList } from "../vfs/commands/list.js";
import { runRead } from "../vfs/commands/read.js";
import { runReplace } from "../vfs/commands/replace.js";
import { runWrite } from "../vfs/commands/write.js";
import { parseCliArgs } from "../vfs/parse-args.js";

const SESSION_VFS_COMMANDS: Record<
  string,
  (vfs: VfsService, args: readonly string[]) => Promise<void>
> = {
  list: runList,
  read: runRead,
  write: (vfs, args) => runWrite(vfs, args, { defaultNoVersionCheck: true }),
  replace: runReplace,
  glob: runGlob,
  grep: runGrep,
  delete: runDelete,
};

function requireProject(flags: ReadonlyMap<string, string | true>): string {
  const id = flags.get("project");
  if (typeof id !== "string") {
    throw new Error("Missing --project <id>");
  }
  return id;
}

function requireSession(flags: ReadonlyMap<string, string | true>): string {
  const id = flags.get("session");
  if (typeof id !== "string") {
    throw new Error("Missing --session <id>");
  }
  return id;
}

export async function runSession(
  deps: {
    sessions: SessionService;
    sessionFs: SessionFsService;
    sessionVfs: (projectId: string, sessionId: string) => VfsService;
  },
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const projectId = requireProject(flags);

  switch (subcommand) {
    case "list": {
      const list = await deps.sessions.listByProject(projectId);
      for (const s of list) {
        console.log(`${s.id}\t${s.title ?? ""}`);
      }
      return;
    }
    case "create": {
      const title =
        typeof flags.get("title") === "string" ? String(flags.get("title")) : null;
      const s = await deps.sessions.create(projectId, title);
      console.log(s.id);
      return;
    }
    case "delete": {
      const sessionId = requireSession(flags);
      await deps.sessions.delete(sessionId);
      return;
    }
    case "copy": {
      const sessionId = requireSession(flags);
      const copy = await deps.sessions.copy(sessionId);
      console.log(copy.id);
      return;
    }
    case "vfs": {
      const vfsRest = args[0] === "vfs" ? args.slice(1) : args;
      await runSessionVfs(deps, projectId, vfsRest);
      return;
    }
    default:
      throw new Error("Usage: nm session <list|create|delete|copy|vfs> ...");
  }
}

async function runSessionVfs(
  deps: {
    sessionFs: SessionFsService;
    sessionVfs: (projectId: string, sessionId: string) => VfsService;
  },
  projectId: string,
  args: readonly string[],
): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const group = positional[0];
  const rest = positional.slice(1);

  if (group === "records") {
    const sub = rest[0];
    const sessionId = requireSession(flags);
    if (sub === "list") {
      const batches = await deps.sessionFs.listBatches(sessionId);
      for (const b of batches) {
        console.log(`${b.id}\t${b.createdBy}\t${b.createdAtMs}`);
      }
      return;
    }
    if (sub === "rollback") {
      const batchId = flags.get("batch");
      if (typeof batchId !== "string") {
        throw new Error(
          "Usage: nm session vfs records rollback --project <id> --session <id> --batch <id>",
        );
      }
      await deps.sessionFs.rollbackBatch(sessionId, projectId, batchId);
      return;
    }
    throw new Error("Usage: nm session vfs records <list|rollback> ...");
  }

  if (group === "snapshot") {
    const sub = rest[0];
    const sessionId = requireSession(flags);
    const file = flags.get("file");
    if (typeof file !== "string") {
      throw new Error("Missing --file <logicalPath>");
    }
    if (sub === "list") {
      const snaps = await deps.sessionFs.listSnapshots(sessionId, file);
      for (const s of snaps) {
        console.log(
          `v${s.snapshotRev}\t${s.status}\t${s.createdBy}\t${s.createdAtMs}`,
        );
      }
      return;
    }
    if (sub === "rollback") {
      const revRaw = flags.get("rev");
      if (typeof revRaw !== "string") {
        throw new Error("Missing --rev <n>");
      }
      await deps.sessionFs.rollbackSnapshot(
        sessionId,
        projectId,
        file,
        Number.parseInt(revRaw, 10),
      );
      return;
    }
    throw new Error("Usage: nm session vfs snapshot <list|rollback> ...");
  }

  if (group == null || !(group in SESSION_VFS_COMMANDS)) {
    throw new Error(
      "Usage: nm session vfs <list|read|write|...> | records ... | snapshot ...",
    );
  }
  const sessionId = requireSession(flags);
  const vfs = deps.sessionVfs(projectId, sessionId);
  const idx = args.indexOf(group);
  const subArgs = args.slice(idx + 1);
  await SESSION_VFS_COMMANDS[group]!(vfs, subArgs);
}
