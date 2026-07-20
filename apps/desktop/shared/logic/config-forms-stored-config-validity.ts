/**
 * Desktop renderer 对 `@novel-master/core/config-forms/stored-config-validity` 的具名薄再导出。
 * 禁止 `export *`。
 *
 * **禁止**再导出 `assess*Wire` / `resolveAgentDefinitionFromStorage`
 *（Steps 11–12 改走 IPC assessed DTO）。
 */

export type { StoredConfigHealth } from "@novel-master/core/config-forms/stored-config-validity";

export {
  AGENT_LIST_LABELS,
  buildDefaultAgentDefinitionPreservingName,
  STORED_CONFIG_LABELS,
  storedConfigInvalidReason,
} from "@novel-master/core/config-forms/stored-config-validity";
