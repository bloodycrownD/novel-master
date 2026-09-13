/**
 * 智能排序的 renderer 安全再导出薄层（照 vfs.ts 惯例）：
 * renderer 不得直接 import core（X1 gate），纯函数经 shared 再导出单源共享。
 */
export {
  formatPatternInput,
  parsePatternInput,
  splitSmartSortHighlightSegments,
} from "@novel-master/core/smart-sort-rule";
export type { SmartSortHighlightSegment } from "@novel-master/core/smart-sort-rule";
