/**
 * Persistent preferences domain errors.
 *
 * @module errors/preferences-errors
 */

/** Discriminant codes for {@link PreferencesError}. */
export type PreferencesErrorCode = "INVALID_VALUE";

/**
 * Unified error for persistent preferences operations.
 */
export class PreferencesError extends Error {
  readonly code: PreferencesErrorCode;
  readonly key?: string;

  constructor(
    code: PreferencesErrorCode,
    message: string,
    options?: { key?: string },
  ) {
    super(message);
    this.name = "PreferencesError";
    this.code = code;
    this.key = options?.key;
  }
}

/**
 * Thrown when a preference value cannot be converted to the requested type.
 */
export function preferencesInvalidValue(
  key: string,
  expectedType: string,
  actualValue: string,
): PreferencesError {
  return new PreferencesError(
    "INVALID_VALUE",
    `Preference key "${key}" expected ${expectedType}, got: ${actualValue}`,
    { key },
  );
}
