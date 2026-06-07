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

/** v2: Show full tool call parameters in chat UI. */
export const PREF_KEY_CHAT_SHOW_FULL_TOOL_PARAMS = "chat.showFullToolParams";

/** v2: SessionFs checkpoint FIFO retention count (stored as int string). */
export const PREF_KEY_SESSION_FS_CHECKPOINT_RETENTION =
  "session-fs.checkpointRetention";

/** Default checkpoint retention when unset. */
export const DEFAULT_CHECKPOINT_RETENTION = 100;

/** Valid range for checkpoint retention (inclusive). */
export const MIN_CHECKPOINT_RETENTION = 1;
export const MAX_CHECKPOINT_RETENTION = 9999;
