/**
 * Session-scoped worktree/filetree macro cache port.
 *
 * @module service/prompt/session-macro-cache.port
 */

export interface SessionMacroSnapshot {
  readonly worktreeDisplay: string;
  readonly filetreeDisplay: string;
  readonly refreshedAtMs: number;
}

export interface SessionMacroCache {
  get(projectId: string, sessionId: string): SessionMacroSnapshot | undefined;
  refresh(
    projectId: string,
    sessionId: string,
    render: () => Promise<{
      readonly worktreeDisplay: string;
      readonly filetreeDisplay: string;
    }>,
  ): Promise<SessionMacroSnapshot>;
  clear(projectId: string, sessionId: string): void;
}
