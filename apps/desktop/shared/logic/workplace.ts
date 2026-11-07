/**
 * Desktop renderer 对 `@novel-master/core/workplace` 的具名薄再导出。
 * 禁止 `export *`；禁止 createWorkplaceService 等工厂。
 *
 * core 侧 label 函数已返回 descriptor（G3.2）：本层经 `coreT` 翻译成 string
 * 再导出，renderer 消费点零改动。
 */

import { displayStateLabel as coreDisplayStateLabel, inclusionModeLabel as coreInclusionModeLabel, ruleStateLabel as coreRuleStateLabel } from "@novel-master/core/workplace";
import { coreT } from "./core-i18n.js";

// nm-style: keep-public — desktop shared/logic 是唯一的 core-descriptor→string 翻译边界（apps/desktop/renderer 零 `@novel-master/core` import）；与同文件 inclusionModeLabel / displayStateLabel 三件套同构，唯一调用点 vfs-tree-utils 同时消费这三者。
export function ruleStateLabel(state: Parameters<typeof coreRuleStateLabel>[0]): string {
  return coreT(coreRuleStateLabel(state));
}

export function inclusionModeLabel(mode: Parameters<typeof coreInclusionModeLabel>[0]): string {
  return coreT(coreInclusionModeLabel(mode));
}

export function displayStateLabel(state: Parameters<typeof coreDisplayStateLabel>[0]): string {
  return coreT(coreDisplayStateLabel(state));
}

export { DEFAULT_WORKPLACE_DIR_RULE } from "@novel-master/core/workplace";
