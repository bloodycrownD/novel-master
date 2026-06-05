/**
 * Global compaction conditions (triggers only; actions live in events config).
 *
 * @module domain/compaction-conditions/model/compaction-conditions
 */

/** OR trigger fields; at least one required when enabled. */
export interface CompactionConditionsTrigger {
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
}

export interface CompactionConditions {
  readonly schemaVersion: 3;
  readonly enabled: boolean;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
}
