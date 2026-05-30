/**
 * Model resolution context passed from AgentRunner into compaction pipeline.
 *
 * @module domain/agent/compaction/compaction-model-context
 */

/** Dialogue model already resolved for this run; optional CLI override for summary chain. */
export interface CompactionModelContext {
  /** Conversation agent's resolved applicationModelId. */
  readonly dialogueApplicationModelId: string;
  /** Set when host resolved id from `--modelId` (summary chain reuses flag priority). */
  readonly cliModelId?: string;
}
