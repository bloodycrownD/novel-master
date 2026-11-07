/**
 * Workplace list UI labels（descriptor 形态，宿主 translator 渲染）。
 *
 * @module domain/workplace/logic/workplace-labels
 */

import type { CoreMessageDescriptor } from "@/i18n/keys.js";
import type { DisplayState, InclusionMode, RuleState } from "../model/workplace-types.js";

export function ruleStateLabel(state: RuleState): CoreMessageDescriptor {
  return state === "rule_on" ? { key: "label.workplace.rule_on" } : { key: "label.workplace.rule_off" };
}

export function inclusionModeLabel(mode: InclusionMode): CoreMessageDescriptor {
  switch (mode) {
    case "auto":
      return { key: "label.workplace.inclusion.auto" };
    case "show":
      return { key: "label.workplace.inclusion.show" };
    case "hide":
      return { key: "label.workplace.inclusion.hide" };
  }
}

export function displayStateLabel(state: DisplayState): CoreMessageDescriptor {
  switch (state) {
    case "hidden":
      return { key: "label.workplace.display.hidden" };
    case "full":
      return { key: "label.workplace.display.full" };
    case "header":
      return { key: "label.workplace.display.header" };
    case "filename":
      return { key: "label.workplace.display.filename" };
  }
}

/** `{{$filetree}}` 宏文件行尾加载状态文案（进提示词，保持 string 不迁，spec G3.2）。 */
export function filetreeMacroLoadStateLabel(state: DisplayState): string {
  switch (state) {
    case "full":
      return "全部加载";
    case "header":
      return "部分加载";
    case "filename":
    case "hidden":
      return "未加载";
  }
}
