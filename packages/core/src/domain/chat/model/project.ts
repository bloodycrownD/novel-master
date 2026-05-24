/**
 * Chat project model.
 *
 * @module domain/chat/model/project
 */

/** A novel/chat project container for sessions and template VFS. */
export interface ChatProject {
  readonly id: string;
  readonly name: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
