/**
 * Errors raised when reading or writing CLI `config.json`.
 *
 * @module config/cli-config-errors
 */

/** Thrown when `config.json` exists but is not valid JSON. */
export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliConfigError";
  }
}
