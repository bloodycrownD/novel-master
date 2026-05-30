/**
 * Global compaction policy (independent of {@link AgentDefinition}).
 *
 * @module domain/compaction/compaction-policy
 */

/** Flat OR trigger: token estimate or visible message floor. */
export interface CompactionTriggerConfig {
  readonly tokenThreshold?: number;
  readonly floorThreshold?: number;
}

/** Static text abstract or LLM summary via a registered agent. */
export type CompactionAbstractConfig =
  | { readonly type: "text"; readonly content: string }
  | {
      readonly type: "agent";
      readonly agentId: string;
      readonly instruction?: string;
    };

/** Compaction action: hide older messages and produce abstract text. */
export interface CompactionActionConfig {
  readonly keepLastN: number;
  readonly abstract: CompactionAbstractConfig;
}

/** Global compaction policy persisted as a single KKV document. */
export interface CompactionPolicy {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly trigger: CompactionTriggerConfig;
  readonly action: CompactionActionConfig;
}
