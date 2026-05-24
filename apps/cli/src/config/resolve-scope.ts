/**
 * Resolves `--project` / `--session` from CLI flags or `config.json`.
 *
 * @module config/resolve-scope
 */

import type { CliConfig } from "./cli-config.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function configString(
  config: CliConfig,
  key: keyof Pick<CliConfig, "currentProjectId" | "currentSessionId">,
): string | undefined {
  const value = config[key];
  return value != null && value !== "" ? value : undefined;
}

/**
 * Priority: CLI flag > `config.json` > thrown error with usage hint.
 */
export class CliScopeResolver {
  constructor(
    private config: CliConfig,
    _hints: { configPath: string },
  ) {}

  /** Snapshot of config-backed ids (ignores CLI flags). */
  getConfigSnapshot(): Readonly<CliConfig> {
    return this.config;
  }

  /** Updates the in-memory config used for subsequent resolves in the same process. */
  replaceConfig(config: CliConfig): void {
    this.config = config;
  }

  /** Flag `--project` > `config.currentProjectId`. */
  resolveProjectId(flags: ReadonlyMap<string, string | true>): string {
    const fromFlag = flagString(flags, "project");
    if (fromFlag != null) {
      return fromFlag;
    }
    const fromConfig = configString(this.config, "currentProjectId");
    if (fromConfig != null) {
      return fromConfig;
    }
    throw new Error(
      "Missing --project <id> (or run: nm project use --project <id>)",
    );
  }

  /** Flag `--session` > `config.currentSessionId`. */
  resolveSessionId(flags: ReadonlyMap<string, string | true>): string {
    const fromFlag = flagString(flags, "session");
    if (fromFlag != null) {
      return fromFlag;
    }
    const fromConfig = configString(this.config, "currentSessionId");
    if (fromConfig != null) {
      return fromConfig;
    }
    throw new Error(
      "Missing --session <id> (or run: nm session use --session <id>)",
    );
  }

  /** Resolves both project and session scope (session vfs, records, snapshot). */
  resolveProjectSession(flags: ReadonlyMap<string, string | true>): {
    projectId: string;
    sessionId: string;
  } {
    return {
      projectId: this.resolveProjectId(flags),
      sessionId: this.resolveSessionId(flags),
    };
  }
}
