/**
 * Regex rule entity (SQL-backed, ordered within group).
 *
 * @module domain/regex/model/regex-rule
 */

/** Single pattern + replacement config within a regex group. */
export interface RegexRule {
  readonly groupId: string;
  readonly ruleId: string;
  readonly sortOrder: number;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly enabled: boolean;
  readonly llmReplace: string | null;
  readonly displayReplace: string | null;
  readonly startDepth: number | null;
  readonly endDepth: number | null;
  readonly scopeUser: boolean;
  readonly scopeAssistant: boolean;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}
