/**
 * Resolves `--project` / `--session` from CLI flags or {@link PersistentState}.
 *
 * @module config/resolve-scope
 */

import type { PersistentState } from "@novel-master/core";
import { type AppError, Result } from "@novel-master/core/errors";

function flagString(flags: ReadonlyMap<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

/**
 * Priority: CLI flag > persistent state > usage error (throw → main 边界 catch).
 * repo 读的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
export class CliScopeResolver {
  constructor(private readonly state: PersistentState) {}

  /** Flag `--project` > `getCurrentProjectId()`. */
  async resolveProjectId(flags: ReadonlyMap<string, string | true>): Promise<Result<string, AppError>> {
    const fromFlag = flagString(flags, "project");
    if (fromFlag != null) {
      return Result.ok(fromFlag);
    }
    const fromState = await this.state.getCurrentProjectId();
    if (!fromState.ok) return Result.err(fromState.error);
    if (fromState.value != null && fromState.value !== "") {
      return Result.ok(fromState.value);
    }
    throw new Error("Missing --project <id> (or run: nm project use --project <id>)");
  }

  /** Flag `--session` > `getCurrentSessionId()`. */
  async resolveSessionId(flags: ReadonlyMap<string, string | true>): Promise<Result<string, AppError>> {
    const fromFlag = flagString(flags, "session");
    if (fromFlag != null) {
      return Result.ok(fromFlag);
    }
    const fromState = await this.state.getCurrentSessionId();
    if (!fromState.ok) return Result.err(fromState.error);
    if (fromState.value != null && fromState.value !== "") {
      return Result.ok(fromState.value);
    }
    throw new Error("Missing --session <id> (or run: nm session use --session <id>)");
  }

  /** Resolves both project and session scope (session vfs, snapshot). */
  async resolveProjectSession(flags: ReadonlyMap<string, string | true>): Promise<
    Result<
      {
        projectId: string;
        sessionId: string;
      },
      AppError
    >
  > {
    const project = await this.resolveProjectId(flags);
    if (!project.ok) return Result.err(project.error);
    const session = await this.resolveSessionId(flags);
    if (!session.ok) return Result.err(session.error);
    return Result.ok({ projectId: project.value, sessionId: session.value });
  }
}
