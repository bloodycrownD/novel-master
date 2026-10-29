/**
 * 存储配置失效面板与列表统一文案。
 *
 * @module domain/agent/stored-config-validity/labels
 */

import type { StoredConfigInvalidCode } from "./types.js";

/** 失效原因 → 用户可读说明。 */
export function storedConfigInvalidReason(
  code: StoredConfigInvalidCode
): string {
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
  invalidTitle: "配置已失效",
  reasonOutdatedVersion: "配置版本过旧，当前应用无法读取",
  reasonRemovedFeature: "配置含已移除的字段或动作",
  reasonBrokenWire: "配置格式损坏，无法解析",
  eventsRestoreAndSave: "恢复默认并保存",
  eventsClearAndSave: "清空旧配置并保存默认",
  agentDelete: "删除该智能体",
  agentOverwriteDefault: "用默认模板覆盖并保存",
  agentBack: "返回",
} as const;

/** Agent 列表文案（含失效标签；基础项自表单层 ui-labels 并入）。 */
export const AGENT_LIST_LABELS = {
  needsRepair: "需修复",
  maxSteps: (n: number) => `最大步数 ${n}`,
  configInvalid: "配置已失效",
} as const;
