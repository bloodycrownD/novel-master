/**
 * Compaction conditions KKV store port.
 *
 * @module service/compaction-conditions/compaction-conditions-store.port
 */

import type { CompactionConditions } from "@/domain/compaction-conditions/model/compaction-conditions.js";

export interface CompactionConditionsStore {
  getConditions(): Promise<CompactionConditions | null>;
  setConditions(conditions: CompactionConditions): Promise<void>;
  clearConditions(): Promise<void>;
}
