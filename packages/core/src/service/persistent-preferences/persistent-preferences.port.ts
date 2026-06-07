/**
 * Behavioral preferences port (KKV module `nm-preferences`).
 *
 * @module service/persistent-preferences/persistent-preferences.port
 */

/**
 * v1 frozen preferences; v2 extends via explicit typed methods (no raw UI writes).
 */
export interface PersistentPreferences {
  /**
   * Session FS optimistic version check (default `true` when unset).
   */
  getSessionFsVersionCheck(): Promise<boolean>;
  setSessionFsVersionCheck(enabled: boolean): Promise<void>;
  resetSessionFsVersionCheck(): Promise<void>;

  /**
   * LLM chat SSE streaming (default `true` when unset).
   */
  getLlmStreamEnabled(): Promise<boolean>;
  setLlmStreamEnabled(enabled: boolean): Promise<void>;
  resetLlmStreamEnabled(): Promise<void>;

  /**
   * Show full tool call parameters in chat UI (default `false` when unset).
   */
  getShowFullToolParams(): Promise<boolean>;
  setShowFullToolParams(enabled: boolean): Promise<void>;
  resetShowFullToolParams(): Promise<void>;

  /**
   * SessionFs checkpoint FIFO retention count (default `100` when unset).
   * @throws {PreferencesError} `INVALID_VALUE` when stored or set value is not an integer in 1..9999
   */
  getCheckpointRetention(): Promise<number>;
  setCheckpointRetention(count: number): Promise<void>;
  resetCheckpointRetention(): Promise<void>;

  /** All entries in `nm-preferences`, sorted by key (for `nm preferences list`). */
  list(): Promise<ReadonlyArray<{ key: string; value: string }>>;

  /** Raw preference value (undefined when unset). */
  getPreference(key: string): Promise<string | undefined>;
  setPreference(key: string, value: string): Promise<void>;
}
