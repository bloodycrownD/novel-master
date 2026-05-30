/**
 * `nm session` subcommands.
 *
 * @module session/commands
 */

import { resolveSessionUseId } from "../config/resolve-entity.js";
import type { NovelMasterRuntime } from "../runtime.js";
import { runDelete } from "../vfs/commands/delete.js";
import { runGlob } from "../vfs/commands/glob.js";
import { runGrep } from "../vfs/commands/grep.js";
import { runList } from "../vfs/commands/list.js";
import { runRead } from "../vfs/commands/read.js";
import { runReplace } from "../vfs/commands/replace.js";
import { runWrite } from "../vfs/commands/write.js";
import { runSessionTemplate } from "./template.js";
import { runSessionWorktree } from "./worktree.js";
import { parseCliArgs } from "../vfs/parse-args.js";

/** Session VFS subcommands except `write` (version check comes from preferences). */
const SESSION_VFS_COMMANDS = {
  list: runList,
  read: runRead,
  replace: runReplace,
  glob: runGlob,
  grep: runGrep,
  delete: runDelete,
} as const;

type SessionDeps = Pick<
  NovelMasterRuntime,
  | "state"
  | "preferences"
  | "sessions"
  | "sessionFs"
  | "sessionVfs"
  | "scope"
  | "worktree"
>;

export async function runSession(
  deps: SessionDeps,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const projectId = await deps.scope.resolveProjectId(flags);
      const list = await deps.sessions.listByProject(projectId);
      for (const s of list) {
        console.log(`${s.id}\t${s.title ?? ""}`);
      }
      return;
    }
    case "create": {
      const projectId = await deps.scope.resolveProjectId(flags);
      const title =
        typeof flags.get("title") === "string" ? String(flags.get("title")) : null;
      const s = await deps.sessions.create(projectId, title);
      // Set current project and session
      await deps.state.setCurrentProjectId(projectId);
      await deps.state.setCurrentSessionId(s.id);
      console.log(s.id);
      return;
    }
    case "use": {
      const currentProjectId = await deps.state.getCurrentProjectId();
      const id = await resolveSessionUseId(
        deps.sessions,
        flags,
        currentProjectId,
      );
      const session = await deps.sessions.get(id);
      // Set current project and session
      await deps.state.setCurrentProjectId(session.projectId);
      await deps.state.setCurrentSessionId(id);
      return;
    }
    case "current": {
      const id = await deps.state.getCurrentSessionId();
      if (id == null || id === "") {
        throw new Error(
          "No current session (run: nm session use --session <id> or --title <title>)",
        );
      }
      const s = await deps.sessions.get(id);
      console.log(`${s.id}\t${s.title ?? ""}`);
      return;
    }
    case "delete": {
      const sessionId = await deps.scope.resolveSessionId(flags);
      await deps.sessions.delete(sessionId);
      // Clear current session if it was deleted
      const currentSessionId = await deps.state.getCurrentSessionId();
      if (currentSessionId === sessionId) {
        await deps.state.resetCurrentSessionId();
      }
      return;
    }
    case "copy": {
      const sessionId = await deps.scope.resolveSessionId(flags);
      const copy = await deps.sessions.copy(sessionId);
      console.log(copy.id);
      return;
    }
    case "vfs": {
      const vfsRest = args[0] === "vfs" ? args.slice(1) : args;
      await runSessionVfs(deps, vfsRest);
      return;
    }
    case "worktree":
      await runSessionWorktree(deps, args);
      return;
    case "template": {
      const templateSub = args[0];
      if (templateSub == null) {
        throw new Error("Usage: nm session template pull ...");
      }
      await runSessionTemplate(deps, templateSub, args.slice(1));
      return;
    }
    default:
      throw new Error(
        "Usage: nm session <list|create|use|current|delete|copy|vfs|worktree|template> ...",
      );
  }
}

async function runSessionVfs(deps: SessionDeps, args: readonly string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const { projectId, sessionId } = await deps.scope.resolveProjectSession(flags);
  const group = positional[0];
  const rest = positional.slice(1);

  if (group === "records") {
    const sub = rest[0];
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
          "Usage: nm session vfs records rollback [--project <id>] [--session <id>] --batch <id>",
        );
      }
      await deps.sessionFs.rollbackBatch(sessionId, projectId, batchId);
      return;
    }
    throw new Error("Usage: nm session vfs records <list|rollback> ...");
  }

  if (group === "snapshot") {
    const sub = rest[0];
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

  const vfs = deps.sessionVfs(projectId, sessionId);
  const idx = args.indexOf(group);
  const subArgs = args.slice(idx + 1);

  if (group === "write") {
    const versionCheck = await deps.preferences.getSessionFsVersionCheck();
    await runWrite(vfs, subArgs, { defaultNoVersionCheck: !versionCheck });
    return;
  }

  if (group == null || !(group in SESSION_VFS_COMMANDS)) {
    throw new Error(
      "Usage: nm session vfs <list|read|write|...> | records ... | snapshot ...",
    );
  }

  const builtin = group as keyof typeof SESSION_VFS_COMMANDS;
  await SESSION_VFS_COMMANDS[builtin](vfs, subArgs);
}
