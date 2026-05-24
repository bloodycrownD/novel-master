/**
 * KKV entry model.
 *
 * @module domain/kkv/model/kkv-entry
 */

/** A module-scoped key-value row. */
export interface KkvEntry {
  readonly module: string;
  readonly key: string;
  readonly value: string;
}
