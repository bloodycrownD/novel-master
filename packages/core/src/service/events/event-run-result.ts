/**
 * Result of executing an event action chain.
 *
 * @module service/events/event-run-result
 */

export interface EventActionFailure {
  readonly actionType: string;
  readonly error: string;
}

export interface EventRunResult {
  readonly ok: boolean;
  readonly partialFailure: boolean;
  readonly failures: readonly EventActionFailure[];
}
