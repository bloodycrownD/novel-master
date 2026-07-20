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
import { runMkdir } from "../vfs/commands/mkdir.js";
import { runRead } from "../vfs/commands/read.js";
import { runReplace } from "../vfs/commands/replace.js";
import { runWrite } from "../vfs/commands/write.js";
import { runExportZip } from "../vfs/commands/export-zip.js";
import { runImportZip } from "../vfs/commands/import-zip.js";
import { runSessionTemplate } from "./template.js";
import { runSessionWorkplace } from "./workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

/** Session VFS subcommands except `write` (version check comes from preferences). */
const SESSION_VFS_COMMANDS = {
  list: runList,
  mkdir: runMkdir,
  read: runRead,
  replace: runReplace,
  glob: runGlob,
  grep: runGrep,
  delete: runDelete,
} as const;

type SessionDeps = Pick<
  NovelMasterRuntime,
  | "conn"
  | "state"
  | "preferences"
  | "sessions"
  | "sessionFs"
  | "sessionVfs"
  | "scope"
  | "workplace"
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
    case "workplace":
      await runSessionWorkplace(deps, args);
      return;
    case "template": {
      const templateSub = args[0];
      if (templateSub == null) {
        throw new Error("Usage: nm session template pull ...");
      }
      await runSessionTemplate(deps, templateSub, args.slice(1));
      return;
    }
    case "rollback": {
      const messageId = flags.get("message");
      if (typeof messageId !== "string" || messageId === "") {
        throw new Error(
          "Usage: nm session rollback [--project <id>] [--session <id>] --message <messageId>",
        );
      }
      const { projectId, sessionId } = await deps.scope.resolveProjectSession(flags);
      await deps.sessionFs.rollbackToMessage(sessionId, projectId, messageId);
      return;
    }
    default:
      throw new Error(
        "Usage: nm session <list|create|use|current|delete|copy|vfs|workplace|template|rollback> ...",
      );
  }
}

async function runSessionVfs(deps: SessionDeps, args: readonly string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const { projectId, sessionId } = await deps.scope.resolveProjectSession(flags);
  const group = positional[0];

  if (group === "export-zip") {
    const idx = args.indexOf(group);
    await runExportZip(
      deps.conn,
      { kind: "session", projectId, sessionId },
      args.slice(idx + 1),
    );
    return;
  }
  if (group === "import-zip") {
    const idx = args.indexOf(group);
    await runImportZip(
      deps.conn,
      { kind: "session", projectId, sessionId },
      args.slice(idx + 1),
    );
    return;
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
      "Usage: nm session vfs <list|read|write|export-zip|import-zip|...>",
    );
  }

  const builtin = group as keyof typeof SESSION_VFS_COMMANDS;
  await SESSION_VFS_COMMANDS[builtin](vfs, subArgs);
}
