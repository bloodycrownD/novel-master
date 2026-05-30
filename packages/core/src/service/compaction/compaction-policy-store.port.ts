/**
 * Global compaction policy persistence port (KKV module `nm-compaction`).
 *
 * @module service/compaction/compaction-policy-store.port
 */

import type { CompactionPolicy } from "@/domain/compaction/compaction-policy.js";

/** Reads and writes the single global compaction policy document. */
export interface CompactionPolicyStore {
  /**
   * Returns stored policy, or `null` when unset (treated as disabled).
   * Corrupt or legacy KKV JSON that fails decode is also `null`.
   */
  getPolicy(): Promise<CompactionPolicy | null>;
  setPolicy(policy: CompactionPolicy): Promise<void>;
  clearPolicy(): Promise<void>;
}
