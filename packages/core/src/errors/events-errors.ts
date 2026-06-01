/**
 * Events configuration and orchestration errors.
 *
 * @module errors/events-errors
 */

export type EventsErrorCode =
  | "INVALID_SCHEMA"
  | "NOT_FOUND"
  | "UNKNOWN_EVENT"
  | "ACTION_FAILED";

export class EventsError extends Error {
  readonly code: EventsErrorCode;

  constructor(
    code: EventsErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EventsError";
    this.code = code;
  }
}
