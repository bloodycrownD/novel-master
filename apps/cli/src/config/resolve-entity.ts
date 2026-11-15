/**
 * Resolves project/session ids from human-readable labels for `use` subcommands.
 *
 * @module config/resolve-entity
 */

import { type ProjectService, type SessionService } from "@novel-master/core/chat";
import { type AppError, Result } from "@novel-master/core/errors";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * `use` target: `--project <id>` or unique `--name <name>` among all projects.
 * repo 读的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
export async function resolveProjectUseId(
  projects: ProjectService,
  flags: ReadonlyMap<string, string | true>,
): Promise<Result<string, AppError>> {
  const byId = flagString(flags, "project");
  if (byId != null) {
    const exists = await projects.get(byId);
    if (!exists.ok) return Result.err(exists.error);
    return Result.ok(byId);
  }

  const byName = flagString(flags, "name");
  if (byName != null) {
    const matches = (await projects.list()).filter((p) => p.name === byName);
    if (matches.length === 0) {
      throw new Error(`No project named ${JSON.stringify(byName)}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous project name ${JSON.stringify(byName)} (${matches.length} matches)`,
      );
    }
    return Result.ok(matches[0]!.id);
  }

  throw new Error(
    "Usage: nm project use --project <id> | --name <name>",
  );
}

/**
 * `use` target: `--session <id>` or unique `--title` / `--name` under a project.
 *
 * Project scope: `--project` flag, else `defaultProjectId` from config.
 */
export async function resolveSessionUseId(
  sessions: SessionService,
  flags: ReadonlyMap<string, string | true>,
  defaultProjectId: string | undefined,
): Promise<Result<string, AppError>> {
  const byId = flagString(flags, "session");
  if (byId != null) {
    const exists = await sessions.get(byId);
    if (!exists.ok) return Result.err(exists.error);
    return Result.ok(byId);
  }

  const label =
    flagString(flags, "title") ?? flagString(flags, "name");
  if (label != null) {
    const projectId = flagString(flags, "project") ?? defaultProjectId;
    if (projectId == null) {
      throw new Error(
        "Missing --project <id> for title lookup (or set current project via nm project use)",
      );
    }
    const listed = await sessions.listByProject(projectId);
    if (!listed.ok) return Result.err(listed.error);
    const matches = listed.value.filter(
      (s) => (s.title ?? "") === label,
    );
    if (matches.length === 0) {
      throw new Error(
        `No session titled ${JSON.stringify(label)} in project ${projectId}`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous session title ${JSON.stringify(label)} (${matches.length} matches)`,
      );
    }
    return Result.ok(matches[0]!.id);
  }

  throw new Error(
    "Usage: nm session use --session <id> | --title <title> [--project <id>]",
  );
}
