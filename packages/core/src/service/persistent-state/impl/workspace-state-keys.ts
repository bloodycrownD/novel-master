/**
 * nm-workspace-state KKV 键名 SSoT（与 preference-keys 同级工程化）。
 *
 * @module service/persistent-state/impl/workspace-state-keys
 */

/** CLI/工作区指针 KKV 模块（非 global-config）。 */
export const WORKSPACE_STATE_MODULE = "nm-workspace-state";

export const KEY_CURRENT_PROJECT_ID = "currentProjectId";
export const KEY_CURRENT_SESSION_ID = "currentSessionId";
export const KEY_CURRENT_PROVIDER_ID = "currentProviderId";
export const KEY_CURRENT_MODEL_ID = "currentModelId";
export const KEY_CURRENT_REGEX_GROUP_ID = "currentRegexGroupId";
export const KEY_CURRENT_AGENT_ID = "currentAgentId";