/**
 * Model resolution context passed from AgentRunner into compaction pipeline.
 *
 * @module domain/compaction/compaction-model-context
 */

/** Workspace + optional CLI override for compaction summary model chain. */
export interface CompactionModelContext {
  /** Current workspace model id (`nm model use`); used when summary agent has no pin. */
  readonly workspaceModelId: string;
  /** Set when host resolved id from `--modelId` (summary chain highest priority). */
  readonly cliModelId?: string;
}
