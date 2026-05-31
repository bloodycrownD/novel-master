/**
 * Chinese display labels for worktree list output.
 *
 * @module domain/worktree/worktree-labels
 */

import type {
  DisplayState,
  InclusionMode,
  RuleState,
} from "./model/worktree-types.js";

export function ruleStateLabel(state: RuleState): string {
  return state === "rule_on" ? "规则·开" : "规则·关";
}

export function inclusionModeLabel(mode: InclusionMode): string {
  switch (mode) {
    case "auto":
      return "自动";
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
