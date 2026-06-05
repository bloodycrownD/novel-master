/**
 * quick-sqlite only binds {@link ArrayBuffer} blobs, not {@link Uint8Array}.
 *
 * @module tdbc-driver-rn/bindings
 */

/**
 * Normalizes execute/query parameters for react-native-quick-sqlite.
 */
export function normalizeQuickSqliteBindings(
  parameters?: readonly unknown[],
): unknown[] | undefined {
  if (parameters === undefined) {
    return undefined;
  }
  return parameters.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (value instanceof Uint8Array) {
      // Own a tight copy: quick-sqlite frees the bound buffer; shared/sliced views corrupt the heap.
      return new Uint8Array(value).buffer;
    }
    return value;
  });
}
