/**
 * Chat session model.
 *
 * @module domain/chat/model/session
 */

/** A conversation session within a project. */
export interface ChatSession {
  readonly id: string;
  readonly projectId: string;
  readonly title: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
