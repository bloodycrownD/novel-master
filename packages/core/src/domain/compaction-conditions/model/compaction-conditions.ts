/**
 * Global compaction conditions (triggers only; actions live in events config).
 *
 * @module domain/compaction-conditions/model/compaction-conditions
 */

/** OR trigger fields; at least one required when enabled. */
export interface CompactionConditionsTrigger {
  readonly tokenThreshold?: number;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
}

export interface CompactionConditions {
  readonly schemaVersion: number;
  readonly enabled: boolean;
  readonly tokenThreshold?: number;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
}
