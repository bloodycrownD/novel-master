/**
 * ConfigService port: application-level global configuration.
 *
 * @module service/config/config.port
 */

/**
 * Application-level global configuration service.
 *
 * @remarks
 * All values are stored as strings in KKV (module: "global-config").
 * Type-specific methods handle conversion to/from boolean and number.
 */
export interface ConfigService {
  /**
   * Gets a string value by key.
   * @returns The value, or `undefined` if not set.
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Sets a string value by key.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Gets a boolean value by key.
   * @param defaultValue - Returned if key is not set.
   * @returns `true` if value is "true", `false` if "false", otherwise `defaultValue`.
   * @throws {ConfigError} If value exists but is not "true" or "false" and no default provided.
   */
  getBoolean(key: string, defaultValue?: boolean): Promise<boolean>;

  /**
   * Sets a boolean value by key (stored as "true" or "false").
   */
  setBoolean(key: string, value: boolean): Promise<void>;

  /**
   * Gets a number value by key.
   * @param defaultValue - Returned if key is not set.
   * @returns Parsed number.
   * @throws {ConfigError} If value exists but cannot be parsed as number and no default provided.
   */
  getNumber(key: string, defaultValue?: number): Promise<number>;

  /**
   * Sets a number value by key (stored as string representation).
   */
  setNumber(key: string, value: number): Promise<void>;

  /**
   * Lists all config entries.
   * @returns Array of key-value pairs.
   */
  list(): Promise<Array<{ key: string; value: string }>>;

  /**
   * Resets a config key (deletes from storage).
   */
  reset(key: string): Promise<void>;
}
