/**
 * Desktop renderer 对 `@novel-master/core/stored-config-validity` 的具名薄再导出。
 * 禁止 `export *`。
 *
 * **禁止**再导出 `assess*Wire` / `resolveAgentDefinitionFromStorage`
 *（Steps 11–12 改走 IPC assessed DTO）。
 *
 * core 侧 label 值已是 descriptor（G3.1）：本层经 `coreT` 翻译成 string 再导出，
 * renderer 消费点零改动（UI 拿 string，行为不变）。
 */

import { AGENT_LIST_LABELS as CORE_AGENT_LIST_LABELS, STORED_CONFIG_LABELS as CORE_STORED_CONFIG_LABELS, storedConfigInvalidReason as coreStoredConfigInvalidReason } from "@novel-master/core/stored-config-validity";
import { coreT } from "./core-i18n.js";

export type { StoredConfigHealth } from "@novel-master/core/stored-config-validity";

export const STORED_CONFIG_LABELS = {
  invalidTitle: coreT(CORE_STORED_CONFIG_LABELS.invalidTitle),
  reasonOutdatedVersion: coreT(CORE_STORED_CONFIG_LABELS.reasonOutdatedVersion),
  reasonRemovedFeature: coreT(CORE_STORED_CONFIG_LABELS.reasonRemovedFeature),
  reasonBrokenWire: coreT(CORE_STORED_CONFIG_LABELS.reasonBrokenWire),
  eventsRestoreAndSave: coreT(CORE_STORED_CONFIG_LABELS.eventsRestoreAndSave),
  eventsClearAndSave: coreT(CORE_STORED_CONFIG_LABELS.eventsClearAndSave),
  agentDelete: coreT(CORE_STORED_CONFIG_LABELS.agentDelete),
  agentOverwriteDefault: coreT(CORE_STORED_CONFIG_LABELS.agentOverwriteDefault),
  agentBack: coreT(CORE_STORED_CONFIG_LABELS.agentBack),
} as const;

export const AGENT_LIST_LABELS = {
  needsRepair: coreT(CORE_AGENT_LIST_LABELS.needsRepair),
  maxSteps: (n: number): string => coreT(CORE_AGENT_LIST_LABELS.maxSteps(n)),
  configInvalid: coreT(CORE_AGENT_LIST_LABELS.configInvalid),
} as const;

export function storedConfigInvalidReason(code: Parameters<typeof coreStoredConfigInvalidReason>[0]): string {
  return coreT(coreStoredConfigInvalidReason(code));
}

export { buildDefaultAgentDefinitionPreservingName } from "@novel-master/core/stored-config-validity";
