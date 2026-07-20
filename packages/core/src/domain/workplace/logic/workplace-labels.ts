/**
 * Chinese display labels for workplace list output.
 *
 * @module domain/workplace/logic/workplace-labels
 */

import type {
  DisplayState,
  InclusionMode,
  RuleState,
} from "../model/workplace-types.js";

export function ruleStateLabel(state: RuleState): string {
  return state === "rule_on" ? "规则·开" : "规则·关";
}

export function inclusionModeLabel(mode: InclusionMode): string {
  switch (mode) {
    case "auto":
      return "跟随";
    case "show":
      return "展示";
    case "hide":
      return "隐藏";
  }
}

export function displayStateLabel(state: DisplayState): string {
  switch (state) {
    case "hidden":
      return "不展示";
    case "full":
      return "全内容";
    case "header":
      return "文件头";
    case "filename":
      return "文件名";
  }
}

/** `{{$filetree}}` 宏文件行尾加载状态文案（与 UI 四态标签分离）。 */
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
