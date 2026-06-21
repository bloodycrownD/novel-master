/**
 * Events 配置存储错误。
 *
 * @module errors/events-config-errors
 */

export type EventsConfigErrorCode = "INVALID_JSON" | "INVALID_SCHEMA";

export class EventsConfigError extends Error {
  readonly code: EventsConfigErrorCode;

  constructor(
    code: EventsConfigErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EventsConfigError";
    this.code = code;
  }
}

/** KKV 中 events 配置 JSON 无法解析。 */
export function eventsConfigInvalidJson(
  message: string,
  details?: Record<string, unknown>,
): EventsConfigError {
  return new EventsConfigError("INVALID_JSON", message, details);
}

/** 已解析的 events 配置 wire 不符合 schema。 */
export function eventsConfigInvalidSchema(
  message: string,
  details?: Record<string, unknown>,
): EventsConfigError {
  return new EventsConfigError("INVALID_SCHEMA", message, details);
}

/** 类型守卫；兼容测试中 src/dist 双实例加载。 */
export function isEventsConfigError(
  error: unknown,
  code?: EventsConfigErrorCode,
): error is EventsConfigError {
  if (!(error instanceof EventsConfigError)) {
    if (
      error != null &&
      typeof error === "object" &&
      (error as EventsConfigError).name === "EventsConfigError"
    ) {
      const c = (error as EventsConfigError).code;
      return code == null || c === code;
    }
    return false;
  }
  return code == null || error.code === code;
}
