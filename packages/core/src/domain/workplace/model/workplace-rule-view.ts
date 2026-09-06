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
import type { CompiledSmartSortRule } from "../logic/smart-sort.js";

/** RuleEngine 输入：与 {@link DefaultWorkplaceService.loadContextMetadata} 等价。 */
export interface WorkplaceRuleContext {
  readonly dirRuleMap: ReadonlyMap<string, WorkplaceDirRule>;
  readonly fileRuleMap: ReadonlyMap<string, WorkplaceFileRule>;
  readonly fileSet: ReadonlySet<string>;
  readonly mtimeByPath: ReadonlyMap<string, number>;
  readonly allDirs: ReadonlySet<string>;
  /** 预编译智能排序规则（spec D4）；缺省时 smart 退化为自然排序。 */
  readonly smartRules?: readonly CompiledSmartSortRule[];
  /** 目录 path → mtime（spec D7）；缺省时目录 created/updated 退化为 name 字典序。 */
  readonly dirMtimeByPath?: ReadonlyMap<string, number>;
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
