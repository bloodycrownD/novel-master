/**
 * Resolves project/session ids from human-readable labels for `use` subcommands.
 *
 * @module config/resolve-entity
 */

import type { ProjectService, SessionService } from "@novel-master/core";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * `use` target: `--project <id>` or unique `--name <name>` among all projects.
 */
export async function resolveProjectUseId(
  projects: ProjectService,
  flags: ReadonlyMap<string, string | true>,
): Promise<string> {
  const byId = flagString(flags, "project");
  if (byId != null) {
    await projects.get(byId);
    return byId;
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
    return matches[0]!.id;
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
): Promise<string> {
  const byId = flagString(flags, "session");
  if (byId != null) {
    await sessions.get(byId);
    return byId;
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
    const matches = (await sessions.listByProject(projectId)).filter(
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
    return matches[0]!.id;
  }

  throw new Error(
    "Usage: nm session use --session <id> | --title <title> [--project <id>]",
  );
}
