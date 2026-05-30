/**
 * Regex group entity (SQL-backed).
 *
 * @module domain/regex/model/regex-group
 */

/** A named collection of regex rules; workspace pointer selects the active group. */
export interface RegexGroup {
  readonly groupId: string;
  readonly displayName: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
