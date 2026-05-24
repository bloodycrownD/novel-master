/**
 * KKV repository port (core-internal).
 *
 * @module domain/kkv/repositories/kkv.port
 */

import type { KkvEntry } from "../model/kkv-entry.js";

/**
 * Persistence contract for `kkv_entry` rows.
 */
export interface KkvRepository {
  listKeys(module: string): Promise<string[]>;

  get(module: string, key: string): Promise<KkvEntry | null>;

  set(module: string, key: string, value: string): Promise<void>;

  delete(module: string, key: string): Promise<boolean>;
}
