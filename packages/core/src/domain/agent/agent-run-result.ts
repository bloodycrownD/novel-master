/**
 * Agent run result types.
 *
 * @module domain/agent/agent-run-result
 */

/** Summary of one model round-trip within a run. */
export interface ModelRoundSummary {
  readonly step: number;
  readonly hadToolUse: boolean;
  readonly finished: boolean;
}

/** Outcome of {@link AgentRunner.run}. */
export interface AgentRunResult {
  readonly stepsExecuted: number;
  readonly finished: boolean;
  /** `DOOM_LOOP` terminates via thrown {@link AgentError}, not this field. */
  readonly stopReason: "completed" | "max_steps" | "error";
  readonly rounds: readonly ModelRoundSummary[];
}
