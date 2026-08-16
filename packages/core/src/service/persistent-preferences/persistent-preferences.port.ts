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

  /** User VFS 统一 tool turn（未设置时默认 true）。 */
  getUserVfsUnifiedToolTurn(): Promise<boolean>;
  setUserVfsUnifiedToolTurn(enabled: boolean): Promise<void>;
  resetUserVfsUnifiedToolTurn(): Promise<void>;

  /** All entries in `nm-preferences`, sorted by key (for `nm preferences list`). */
  list(): Promise<ReadonlyArray<{ key: string; value: string }>>;

  /** Raw preference value (undefined when unset). */
  getPreference(key: string): Promise<string | undefined>;
  setPreference(key: string, value: string): Promise<void>;
}
