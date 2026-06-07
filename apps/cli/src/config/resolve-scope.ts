/**
 * Resolves `--project` / `--session` from CLI flags or {@link PersistentState}.
 *
 * @module config/resolve-scope
 */

import type { PersistentState } from "@novel-master/core";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * Priority: CLI flag > persistent state > thrown error with usage hint.
 */
export class CliScopeResolver {
  constructor(private readonly state: PersistentState) {}

  /** Flag `--project` > `getCurrentProjectId()`. */
  async resolveProjectId(flags: ReadonlyMap<string, string | true>): Promise<string> {
    const fromFlag = flagString(flags, "project");
    if (fromFlag != null) {
      return fromFlag;
    }
    const fromState = await this.state.getCurrentProjectId();
    if (fromState != null && fromState !== "") {
      return fromState;
    }
    throw new Error(
      "Missing --project <id> (or run: nm project use --project <id>)",
    );
  }

  /** Flag `--session` > `getCurrentSessionId()`. */
  async resolveSessionId(flags: ReadonlyMap<string, string | true>): Promise<string> {
    const fromFlag = flagString(flags, "session");
    if (fromFlag != null) {
      return fromFlag;
    }
    const fromState = await this.state.getCurrentSessionId();
    if (fromState != null && fromState !== "") {
      return fromState;
    }
    throw new Error(
      "Missing --session <id> (or run: nm session use --session <id>)",
    );
  }

  /** Resolves both project and session scope (session vfs, snapshot). */
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
