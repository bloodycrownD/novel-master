/**
 * Canonical parameter binding: null and undefined both map to SQL NULL.
 *
 * @module infra/tdbc/logic/normalize-bindings
 */

/**
 * Returns a new array with each `undefined` or `null` replaced by `null`.
 */
export function normalizeBindings(
  parameters?: readonly unknown[],
): unknown[] | undefined {
  if (parameters === undefined) {
    return undefined;
  }
  return parameters.map((value) => (value === undefined ? null : value));
}
