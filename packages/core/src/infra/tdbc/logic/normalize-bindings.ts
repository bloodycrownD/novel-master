/**
 * Canonical parameter binding: null and undefined both map to SQL NULL.
 *
 * @module infra/tdbc/logic/normalize-bindings
 */

/**
 * SQL 绑定参数归一化。
 */
export const TdbcBindings = {
  /**
   * Returns a new array with each `undefined` or `null` replaced by `null`.
   */
  normalize(parameters?: readonly unknown[]): unknown[] | undefined {
    if (parameters === undefined) {
      return undefined;
    }
    return parameters.map((value) => (value === undefined ? null : value));
  },
} as const;
