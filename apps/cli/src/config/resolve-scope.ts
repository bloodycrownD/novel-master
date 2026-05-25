/**
 * Resolves `--project` / `--session` from CLI flags or ConfigService.
 *
 * @module config/resolve-scope
 */

import type { ConfigService } from "@novel-master/core";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * Priority: CLI flag > ConfigService > thrown error with usage hint.
 */
export class CliScopeResolver {
  constructor(private readonly config: ConfigService) {}

  /** Flag `--project` > `config.get("currentProjectId")`. */
  async resolveProjectId(flags: ReadonlyMap<string, string | true>): Promise<string> {
    const fromFlag = flagString(flags, "project");
    if (fromFlag != null) {
      return fromFlag;
    }
    const fromConfig = await this.config.get("currentProjectId");
    if (fromConfig != null && fromConfig !== "") {
      return fromConfig;
    }
    throw new Error(
      "Missing --project <id> (or run: nm project use --project <id>)",
    );
  }

  /** Flag `--session` > `config.get("currentSessionId")`. */
  async resolveSessionId(flags: ReadonlyMap<string, string | true>): Promise<string> {
    const fromFlag = flagString(flags, "session");
    if (fromFlag != null) {
      return fromFlag;
    }
    const fromConfig = await this.config.get("currentSessionId");
    if (fromConfig != null && fromConfig !== "") {
      return fromConfig;
    }
    throw new Error(
      "Missing --session <id> (or run: nm session use --session <id>)",
    );
  }

  /** Resolves both project and session scope (session vfs, records, snapshot). */
  async resolveProjectSession(flags: ReadonlyMap<string, string | true>): Promise<{
    projectId: string;
    sessionId: string;
  }> {
    return {
      projectId: await this.resolveProjectId(flags),
      sessionId: await this.resolveSessionId(flags),
    };
  }
}
