/**
 * RuleEngine 输入/输出 DTO。
 *
 * @module domain/worktree/model/worktree-rule-view
 */

import type {
  DisplayState,
  WorktreeDirRule,
  WorktreeFileRule,
  WorktreeRuleRow,
} from "./worktree-types.js";

/** RuleEngine 输入：与 {@link DefaultWorktreeService.loadContextMetadata} 等价。 */
export interface WorktreeRuleContext {
  readonly dirRuleMap: ReadonlyMap<string, WorktreeDirRule>;
  readonly fileRuleMap: ReadonlyMap<string, WorktreeFileRule>;
  readonly fileSet: ReadonlySet<string>;
  readonly mtimeByPath: ReadonlyMap<string, number>;
  readonly allDirs: ReadonlySet<string>;
}

/** evaluateWorktreeRuleView 输出：纯规则视图，不含文件正文。 */
export interface WorktreeRuleView {
  /** DFS 顺序列表行（enum 字段）。 */
  readonly rows: readonly WorktreeRuleRow[];
  /**
   * 各文件 path → 计算后 DisplayState。
   * 键集 = fileSet；与 rows 中 file 行的 displayState 一致。
   */
  readonly displayByPath: ReadonlyMap<string, DisplayState>;
}
