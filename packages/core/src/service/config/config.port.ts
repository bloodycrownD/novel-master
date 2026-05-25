/**
 * Global configuration service port.
 *
 * @module service/config/config.port
 */

/**
 * Application-wide configuration store backed by KKV.
 *
 * @remarks All values are stored as strings in KKV (module: "global-config").
 * Type-specific methods handle conversion to/from string representation.
 */
export interface ConfigService {
  /**
   * Gets a configuration value as string.
   *
   * @returns The value, or `undefined` if the key does not exist.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Sets a configuration value as string.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Gets a configuration value as boolean.
   *
   * @param defaultValue - Returned when the key does not exist.
   * @returns The boolean value.
   * @throws {ConfigError} When the stored value is not "true" or "false".
   */
  getBoolean(key: string, defaultValue?: boolean): Promise<boolean>;

  /**
   * Sets a configuration value as boolean.
   *
   * @remarks Stores "true" for `true`, "false" for `false`.
   */
  setBoolean(key: string, value: boolean): Promise<void>;

  /**
   * Gets a configuration value as number.
   *
   * @param defaultValue - Returned when the key does not exist.
   * @returns The number value.
   * @throws {ConfigError} When the stored value cannot be parsed as a number.
   */
  getNumber(key: string, defaultValue?: number): Promise<number>;

  /**
   * Sets a configuration value as number.
   *
   * @remarks Converts the number to its string representation.
   */
  setNumber(key: string, value: number): Promise<void>;

  /**
   * Lists all configuration entries.
   *
   * @returns Array of key-value pairs, sorted by key.
   */
  list(): Promise<Array<{ key: string; value: string }>>;

  /**
   * Resets (deletes) a configuration key.
   *
   * @remarks After reset, `get(key)` will return `undefined`.
   */
  reset(key: string): Promise<void>;
}
