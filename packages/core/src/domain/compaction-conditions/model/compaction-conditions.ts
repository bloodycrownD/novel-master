/**
 * Global compaction conditions（triggers + hide-message 起始深度）。
 *
 * v4 起，压缩执行所需的 hide-message 起始深度（`hideStartDepth`）直接挂在条件文档上，
 * 不再从事件配置里读取。默认值 6，老 v3 文档读取时由 store 迁移补齐。
 *
 * @module domain/compaction-conditions/model/compaction-conditions
 */

/** `hideStartDepth` 的默认值，与历史事件配置默认值保持一致。 */
export const DEFAULT_HIDE_START_DEPTH = 6 as const;

export interface CompactionConditions {
  readonly schemaVersion: 4;
  readonly enabled: boolean;
  readonly tokenRatio?: number;
  readonly visibleFloor?: number;
  /** hide-message 的起始深度（tail 0 = newest），缺省按 {@link DEFAULT_HIDE_START_DEPTH} 处理。 */
  readonly hideStartDepth?: number;
}
