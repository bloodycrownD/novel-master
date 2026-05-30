/**
 * Behavioral preferences port (KKV module `nm-preferences`).
 *
 * @module service/persistent-preferences/persistent-preferences.port
 */

/**
 * v1 frozen preferences; extend only via PRD + interface changes.
 */
export interface PersistentPreferences {
  /**
   * Session FS optimistic version check (default `true` when unset).
   */
  getSessionFsVersionCheck(): Promise<boolean>;
  setSessionFsVersionCheck(enabled: boolean): Promise<void>;
  resetSessionFsVersionCheck(): Promise<void>;

  /** All entries in `nm-preferences`, sorted by key (for `nm preferences list`). */
  list(): Promise<ReadonlyArray<{ key: string; value: string }>>;
}
