/**
 * `<foreach>` collection normalization for iteration.
 */

/**
 * Normalizes a foreach `collection` value to an array of items, or `[]` when empty.
 * `null`/`undefined`, primitives, and non-plain objects yield an empty list.
 */
export function normalizeCollection(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>);
  }
  return [];
}
