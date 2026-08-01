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

/** User VFS 统一 tool turn（默认 true）。关闭时回滚直写 VFS + 跳过 flush。 */
export const PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN = "vfs.userVfsUnifiedToolTurn";

/** Chat：user ops 总开关（默认 true）。关闭时 executeOp 成功也不写操作日志。 */
export const PREF_KEY_CHAT_USER_OPS_LOG = "chat.userOpsLogEnabled";
