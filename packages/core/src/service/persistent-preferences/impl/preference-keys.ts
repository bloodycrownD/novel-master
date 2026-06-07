/**
 * Canonical `nm-preferences` key constants (single source of truth).
 *
 * @module service/persistent-preferences/impl/preference-keys
 */

/** KKV module for behavioral preferences. */
export const PREFERENCES_MODULE = "nm-preferences";

/** v1: Session FS optimistic version check. */
export const PREF_KEY_SESSION_FS_VERSION_CHECK = "session-fs.versionCheck";

/** v2: LLM chat SSE streaming. */
export const PREF_KEY_CHAT_LLM_STREAM = "chat.llmStream";
