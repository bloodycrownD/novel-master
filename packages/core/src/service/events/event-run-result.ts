/**
 * Result of executing an event action chain.
 *
 * @module service/events/event-run-result
 */

export interface EventActionFailure {
  readonly actionType: string;
  readonly error: string;
}

/**
 * Outcome of an event action chain (sequential or parallel).
 *
 * @property partialFailure - Parallel mode only: some actions succeeded and others
 *   failed (e.g. one parallel action ok, another failed). Failed actions are not rolled back.
 */
export interface EventRunResult {
  readonly ok: boolean;
  readonly partialFailure: boolean;
  readonly failures: readonly EventActionFailure[];
}
