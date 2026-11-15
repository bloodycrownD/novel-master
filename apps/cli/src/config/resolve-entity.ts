/**
 * Resolves project/session ids from human-readable labels for `use` subcommands.
 *
 * @module config/resolve-entity
 */

import { type ProjectService, type SessionService } from "@novel-master/core/chat";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * `use` target: `--project <id>` or unique `--name <name>` among all projects.
  * 解包 throw 边界（错误通道迁移三期门⑦）：repo 读 / 列举的 `Result` 失败原样上抛（core Result → CLI 异常通道转码点），由 main.ts 两个边界 catch（exitCodeForError + formatCliError）收口。
 */
export async function resolveProjectUseId(
  projects: ProjectService,
  flags: ReadonlyMap<string, string | true>,
): Promise<string> {
  const byId = flagString(flags, "project");
  if (byId != null) {
    const exists = await projects.get(byId);
    if (!exists.ok) throw exists.error;
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
    const exists = await sessions.get(byId);
    if (!exists.ok) throw exists.error;
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
    const listed = await sessions.listByProject(projectId);
    if (!listed.ok) throw listed.error;
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
    return matches[0]!.id;
  }

  throw new Error(
    "Usage: nm session use --session <id> | --title <title> [--project <id>]",
  );
}
