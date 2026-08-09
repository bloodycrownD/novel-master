/**
 * Global compaction conditions (triggers only; actions live in events config).
 *
 * @module domain/compaction-conditions/model/compaction-conditions
 */

export interface CompactionConditions {
  readonly schemaVersion: 3;
  readonly enabled: boolean;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
}
