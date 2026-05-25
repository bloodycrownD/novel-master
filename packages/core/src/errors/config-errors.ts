/**
 * Configuration domain errors.
 *
 * @module errors/config-errors
 */

/** Discriminant codes for {@link ConfigError}. */
export type ConfigErrorCode = "INVALID_TYPE";

/**
 * Unified error for configuration service operations.
 */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly key?: string;

  constructor(
    code: ConfigErrorCode,
    message: string,
    options?: { key?: string },
  ) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.key = options?.key;
  }
}

/**
 * Thrown when a configuration value cannot be converted to the requested type.
 *
 * @example
 * ```ts
 * // When "foo" contains "not-a-number"
 * await config.getNumber("foo");
 * // throws ConfigError with code "INVALID_TYPE"
 * ```
 */
export function configInvalidType(
  key: string,
  expectedType: string,
  actualValue: string,
): ConfigError {
  return new ConfigError(
    "INVALID_TYPE",
    `Config key "${key}" expected ${expectedType}, got: ${actualValue}`,
    { key },
  );
}
