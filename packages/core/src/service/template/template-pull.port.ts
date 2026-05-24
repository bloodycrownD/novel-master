/**
 * Template pull service port.
 *
 * @module service/template/template-pull.port
 */

/** Pulls template VFS + worktree from parent scope (overwrite). */
export interface TemplatePullService {
  /** Global → project: mirrors `/template` and global worktree. */
  projectTemplatePull(projectId: string): Promise<void>;

  /**
   * Project → session: mirrors project template, maps worktree,
   * and clears session-fs data (not messages).
   */
  sessionTemplatePull(sessionId: string): Promise<void>;
}
