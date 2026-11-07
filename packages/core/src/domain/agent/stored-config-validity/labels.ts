/**
 * 存储配置失效面板与列表统一文案。
 *
 * 值为 descriptor（key 契约见 `@/i18n/keys`），宿主用 core catalog translator
 * 渲染成 string 进 UI（spec §3.5）。
 *
 * @module domain/agent/stored-config-validity/labels
 */

import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import type { StoredConfigInvalidCode } from "./types.js";

/** 失效原因 → 用户可读说明。 */
export function storedConfigInvalidReason(code: StoredConfigInvalidCode): CoreMessageDescriptor {
  switch (code) {
    case "outdated_version":
      return STORED_CONFIG_LABELS.reasonOutdatedVersion;
    case "removed_feature":
      return STORED_CONFIG_LABELS.reasonRemovedFeature;
    case "broken_wire":
      return STORED_CONFIG_LABELS.reasonBrokenWire;
  }
}

/** 存储配置失效面板与操作按钮文案（Mobile / Desktop 共用）。 */
export const STORED_CONFIG_LABELS = {
  invalidTitle: { key: "label.agent.invalid_title" },
  reasonOutdatedVersion: { key: "label.agent.reason_outdated_version" },
  reasonRemovedFeature: { key: "label.agent.reason_removed_feature" },
  reasonBrokenWire: { key: "label.agent.reason_broken_wire" },
  eventsRestoreAndSave: { key: "label.agent.action_restore_and_save" },
  eventsClearAndSave: { key: "label.agent.action_clear_and_save" },
  agentDelete: { key: "label.agent.action_delete" },
  agentOverwriteDefault: { key: "label.agent.action_overwrite_default" },
  agentBack: { key: "label.agent.action_back" },
} as const satisfies Record<string, CoreMessageDescriptor>;

/** Agent 列表文案（含失效标签；基础项自表单层 ui-labels 并入）。 */
export const AGENT_LIST_LABELS = {
  needsRepair: { key: "label.agent.needs_repair" },
  maxSteps: (n: number): CoreMessageDescriptor => ({ key: "label.agent.max_steps", params: { n } }),
  configInvalid: { key: "label.agent.config_invalid" },
} as const;
