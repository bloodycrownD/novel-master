/**
 * `nm session` subcommands.
 *
 * @module session/commands
 */

import { OUTCOME_COMPLETED } from "../cli-errors.js";
import { resolveSessionUseId } from "../config/resolve-entity.js";
import { type AppError, Result } from "@novel-master/core/errors";
import type { Outcome } from "@novel-master/core/workplace";
import type { VfsService } from "@novel-master/core/vfs";
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
import { runImportCharacterCard } from "../vfs/commands/import-character-card.js";
import { runImportZip } from "../vfs/commands/import-zip.js";
import { runSessionTemplate } from "./template.js";
import { runSessionWorkplace } from "./workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

/** Session VFS subcommands except `write`（write 无版本参数）。 */
const SESSION_VFS_COMMANDS: Record<
  string,
  (vfs: VfsService, args: readonly string[]) => Promise<Result<void, AppError>>
> = {
  list: runList,
  mkdir: runMkdir,
  read: runRead,
  replace: runReplace,
  glob: runGlob,
  grep: runGrep,
  delete: runDelete,
};

type SessionDeps = Pick<
  NovelMasterRuntime,
  | "conn"
  | "state"
  | "sessions"
  | "sessionFs"
  | "sessionVfs"
  | "sessionKkv"
  | "scope"
  | "workplace"
>;

/**
 * repo 读 / 删 / 复制的 `Result` 失败转 `Outcome.failed` 沿管线交回 main 边界
 * （错误通道迁移四期），由统一出口换算 exit code。
 */
export async function runSession(
  deps: SessionDeps,
  subcommand: string,
  args: readonly string[],
): Promise<Outcome<void>> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const resolvedProject = await deps.scope.resolveProjectId(flags);
      if (!resolvedProject.ok) return { kind: "failed", error: resolvedProject.error };
      const projectId = resolvedProject.value;
      const list = await deps.sessions.listByProject(projectId);
      if (!list.ok) return { kind: "failed", error: list.error };
      for (const s of list.value) {
        console.log(`${s.id}\t${s.title ?? ""}`);
      }
      return OUTCOME_COMPLETED;
    }
    case "create": {
      const resolvedProject = await deps.scope.resolveProjectId(flags);
      if (!resolvedProject.ok) return { kind: "failed", error: resolvedProject.error };
      const projectId = resolvedProject.value;
      const title =
        typeof flags.get("title") === "string" ? String(flags.get("title")) : null;
      const s = await deps.sessions.create(projectId, title);
      if (!s.ok) return { kind: "failed", error: s.error };
      // Set current project and session
      await deps.state.setCurrentProjectId(projectId);
      await deps.state.setCurrentSessionId(s.value.id);
      console.log(s.value.id);
      return OUTCOME_COMPLETED;
    }
    case "use": {
      const currentProject = await deps.state.getCurrentProjectId();
      if (!currentProject.ok) return { kind: "failed", error: currentProject.error };
      const currentProjectId = currentProject.value;
      const resolvedSessionId = await resolveSessionUseId(
        deps.sessions,
        flags,
        currentProjectId,
      );
      if (!resolvedSessionId.ok) return { kind: "failed", error: resolvedSessionId.error };
      const id = resolvedSessionId.value;
      const session = await deps.sessions.get(id);
      if (!session.ok) return { kind: "failed", error: session.error };
      // Set current project and session
      await deps.state.setCurrentProjectId(session.value.projectId);
      await deps.state.setCurrentSessionId(id);
      return OUTCOME_COMPLETED;
    }
    case "current": {
      const currentSession = await deps.state.getCurrentSessionId();
      if (!currentSession.ok) return { kind: "failed", error: currentSession.error };
      const id = currentSession.value;
      if (id == null || id === "") {
        throw new Error(
          "No current session (run: nm session use --session <id> or --title <title>)",
        );
      }
      const s = await deps.sessions.get(id);
      if (!s.ok) return { kind: "failed", error: s.error };
      console.log(`${s.value.id}\t${s.value.title ?? ""}`);
      return OUTCOME_COMPLETED;
    }
    case "delete": {
      const resolvedSessionId = await deps.scope.resolveSessionId(flags);
      if (!resolvedSessionId.ok) return { kind: "failed", error: resolvedSessionId.error };
      const sessionId = resolvedSessionId.value;
      const deleted = await deps.sessions.delete(sessionId);
      if (!deleted.ok) return { kind: "failed", error: deleted.error };
      // Clear current session if it was deleted
      const currentSession = await deps.state.getCurrentSessionId();
      if (!currentSession.ok) return { kind: "failed", error: currentSession.error };
      const currentSessionId = currentSession.value;
      if (currentSessionId === sessionId) {
        await deps.state.resetCurrentSessionId();
      }
      return OUTCOME_COMPLETED;
    }
    case "copy": {
      const resolvedSessionId = await deps.scope.resolveSessionId(flags);
      if (!resolvedSessionId.ok) return { kind: "failed", error: resolvedSessionId.error };
      const copy = await deps.sessions.copy(resolvedSessionId.value);
      if (!copy.ok) return { kind: "failed", error: copy.error };
      console.log(copy.value.id);
      return OUTCOME_COMPLETED;
    }
    case "vfs": {
      const vfsRest = args[0] === "vfs" ? args.slice(1) : args;
      const r = await runSessionVfs(deps, vfsRest);
      if (!r.ok) return { kind: "failed", error: r.error };
      return OUTCOME_COMPLETED;
    }
    case "workplace":
      return runSessionWorkplace(deps, args);
    case "template": {
      const templateSub = args[0];
      if (templateSub == null) {
        throw new Error("Usage: nm session template pull ...");
      }
      const r = await runSessionTemplate(deps, templateSub, args.slice(1));
      if (!r.ok) return { kind: "failed", error: r.error };
      return OUTCOME_COMPLETED;
    }
    case "rollback": {
      const messageId = flags.get("message");
      if (typeof messageId !== "string" || messageId === "") {
        throw new Error(
          "Usage: nm session rollback [--project <id>] [--session <id>] --message <messageId>",
        );
      }
      const resolvedScope = await deps.scope.resolveProjectSession(flags);
      if (!resolvedScope.ok) return { kind: "failed", error: resolvedScope.error };
      const { projectId, sessionId } = resolvedScope.value;
      await deps.sessionFs.rollbackToMessage(sessionId, projectId, messageId);
      return OUTCOME_COMPLETED;
    }
    default:
      throw new Error(
        "Usage: nm session <list|create|use|current|delete|copy|vfs|workplace|template|rollback> ...",
      );
  }
}

/**
 * vfs 子命令的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 runSession 转
 * `Outcome.failed` 交回 main 边界。
 */
async function runSessionVfs(deps: SessionDeps, args: readonly string[]): Promise<Result<void, AppError>> {
  const { positional, flags } = parseCliArgs(args);
  const resolvedScope = await deps.scope.resolveProjectSession(flags);
  if (!resolvedScope.ok) return Result.err(resolvedScope.error);
  const { projectId, sessionId } = resolvedScope.value;
  const group = positional[0];

  if (group === "export-zip") {
    const idx = args.indexOf(group);
    return runExportZip(
      deps.conn,
      { kind: "session", projectId, sessionId },
      args.slice(idx + 1),
    );
  }
  if (group === "import-zip") {
    const idx = args.indexOf(group);
    return runImportZip(
      deps.conn,
      { kind: "session", projectId, sessionId },
      args.slice(idx + 1),
    );
  }
  if (group === "import-character-card") {
    const idx = args.indexOf(group);
    return runImportCharacterCard(
      deps.conn,
      { kind: "session", projectId, sessionId },
      args.slice(idx + 1),
    );
  }

  const vfs = deps.sessionVfs(projectId, sessionId);
  const idx = args.indexOf(group);
  const subArgs = args.slice(idx + 1);

  if (group === "write") {
    // 版本比对已从 VFS 底层移除：last-write-wins。
    return runWrite(vfs, subArgs);
  }

  if (group == null || !(group in SESSION_VFS_COMMANDS)) {
    throw new Error(
      "Usage: nm session vfs <list|read|write|export-zip|import-zip|import-character-card|...>",
    );
  }

  return SESSION_VFS_COMMANDS[group]!(vfs, subArgs);
}
