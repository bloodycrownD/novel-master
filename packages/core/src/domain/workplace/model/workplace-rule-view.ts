/**
 * RuleEngine 输入/输出 DTO。
 *
 * @module domain/workplace/model/workplace-rule-view
 */

import type {
  DisplayState,
  WorkplaceDirRule,
  WorkplaceFileRule,
  WorkplaceRuleRow,
} from "./workplace-types.js";

/** RuleEngine 输入：与 {@link DefaultWorkplaceService.loadContextMetadata} 等价。 */
export interface WorkplaceRuleContext {
  readonly dirRuleMap: ReadonlyMap<string, WorkplaceDirRule>;
  readonly fileRuleMap: ReadonlyMap<string, WorkplaceFileRule>;
  readonly fileSet: ReadonlySet<string>;
  readonly mtimeByPath: ReadonlyMap<string, number>;
  readonly allDirs: ReadonlySet<string>;
}

/** evaluateWorkplaceRuleView 输出：纯规则视图，不含文件正文。 */
export interface WorkplaceRuleView {
  /** DFS 顺序列表行（enum 字段）。 */
  readonly rows: readonly WorkplaceRuleRow[];
  /**
   * 各文件 path → 计算后 DisplayState。
   * 键集 = fileSet；与 rows 中 file 行的 displayState 一致。
   */
  readonly displayByPath: ReadonlyMap<string, DisplayState>;
}
