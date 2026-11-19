/**
 * Desktop renderer 对 `@novel-master/core/workplace` 的具名薄再导出。
 * 禁止 `export *`；禁止 WorkplaceServiceFactory 等工厂。
 *
 * core 侧 label 函数已返回 descriptor（G3.2）：本层经 `coreT` 翻译成 string
 * 再导出，renderer 消费点零改动。
 */

import { WorkplaceLabels } from "@novel-master/core/workplace";
import { coreT } from "./core-i18n.js";

// nm-style: keep-public — desktop shared/logic 是唯一的 core-descriptor→string 翻译边界（apps/desktop/renderer 零 `@novel-master/core` import）；与同文件 inclusionModeLabel / displayStateLabel 三件套同构，唯一调用点 vfs-tree-utils 同时消费这三者。
export function ruleStateLabel(state: Parameters<typeof WorkplaceLabels.ruleStateLabel>[0]): string {
  return coreT(WorkplaceLabels.ruleStateLabel(state));
}

// nm-style: keep-public — 与同文件 ruleStateLabel 同构的翻译边界三件套（core-descriptor→string），唯一调用点 vfs-tree-utils 同时消费三者；拆掉一件会拆散同构组。
export function inclusionModeLabel(mode: Parameters<typeof WorkplaceLabels.inclusionModeLabel>[0]): string {
  return coreT(WorkplaceLabels.inclusionModeLabel(mode));
}

// nm-style: keep-public — 与同文件 ruleStateLabel 同构的翻译边界三件套（core-descriptor→string），唯一调用点 vfs-tree-utils 同时消费三者；拆掉一件会拆散同构组。
export function displayStateLabel(state: Parameters<typeof WorkplaceLabels.displayStateLabel>[0]): string {
  return coreT(WorkplaceLabels.displayStateLabel(state));
}

export { DEFAULT_WORKPLACE_DIR_RULE } from "@novel-master/core/workplace";
