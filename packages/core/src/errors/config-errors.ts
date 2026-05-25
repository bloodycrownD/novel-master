/**
 * Config domain errors.
 *
 * @module errors/config-errors
 */

/** Discriminant codes for {@link ConfigError}. */
export type ConfigErrorCode = "INVALID_TYPE";

/**
 * Unified error for ConfigService operations.
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
 * Creates an INVALID_TYPE error when a config value cannot be converted to expected type.
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
