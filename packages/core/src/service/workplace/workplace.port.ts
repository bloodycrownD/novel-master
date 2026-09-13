/**
 * Workplace application service port.
 *
 * @module service/workplace/workplace.port
 */

import type {
  SetDirRuleInput,
  SetFileRuleInput,
  WorkplaceDirRule,
  WorkplaceListRow,
  WorkplaceScope,
} from "@/domain/workplace/model/workplace-types.js";
import type { WorkplaceRuleView } from "@/domain/workplace/model/workplace-rule-view.js";
import type { CompiledSmartSortRule } from "@/domain/workplace/logic/smart-sort.js";
import type { SmartSortRule } from "@/domain/smart-sort-rule/model/smart-sort-rule.js";

/**
 * 懒加载智能排序规则 provider（spec Step 6）：仅当存在 sortField='smart'
 * 的目录规则时才被调用（查表 + 编译），与排序消费端共用基线口径——是否
 * 启用由规则编译结果决定（core/B-1 后加载侧不做启用预过滤）；三端
 * runtime 经 {@link createWorkplaceService} 工厂默认组装，零逐端接线。
 */
export type SmartRulesProvider = () => Promise<readonly CompiledSmartSortRule[]>;

/**
 * 智能排序规则原始行 provider（L1 缓存签名采样用，core/B-3）：每次评估
 * 无条件全量读取（仅查表，不编译）；smart_sort_rule 表小、管理页改动低频，
 * 过度失效可接受。经 {@link createWorkplaceService} 工厂默认组装。
 */
export type SmartRuleRowsProvider = () => Promise<readonly SmartSortRule[]>;

/** 消费方 ①：工作区列表 + `{{$filetree}}` 宏，单次元数据遍历产出。 */
export interface WorkplaceLiveView {
  readonly listRows: readonly WorkplaceListRow[];
  readonly filetreeDisplay: string;
}

/** 消费方 ②：提示词持久 workplace 块（不含列表与宏树）。 */
export interface WorkplacePersistBlock {
  readonly workplaceDisplay: string;
}

/**
 * 向后兼容：列表 + 持久块 + 宏树。
 *
 * @deprecated 使用 {@link WorkplaceLiveView} / {@link WorkplacePersistBlock}。
 */
export interface WorkplaceMaterialized {
  readonly listRows: readonly WorkplaceListRow[];
  readonly workplaceDisplay: string;
  readonly filetreeDisplay: string;
}

/** Workplace configuration and display operations for one VFS scope. */
export interface WorkplaceService {
  readonly scope: WorkplaceScope;

  setDirRule(input: SetDirRuleInput): Promise<void>;

  getDirRule(logicalPath: string): Promise<WorkplaceDirRule | undefined>;

  /** 拉取本 scope 全部目录规则行（工具侧一次取全量、内存求差集用）。 */
  listDirRules(): Promise<WorkplaceDirRule[]>;

  setFileRule(input: SetFileRuleInput): Promise<void>;

  /** 删除路径及其子路径下的 workplace 纳入/目录规则（VFS 删除后清理 Explorer 幽灵目录）。 */
  deleteRulesUnderLogicalPrefix(logicalPrefix: string): Promise<void>;

  /**
   * 批量重命名路径及其子路径下的规则（rename 目录时用）。
   *
   * 一条 SQL UPDATE 替代逐条 get+set，70 文件目录从 ~1s 降到几 ms。
   */
  renameRulesUnderLogicalPrefix(
    oldPrefix: string,
    newPrefix: string
  ): Promise<void>;

  /**
   * 向后兼容：组合 {@link materializeLiveView} 与 {@link materializePersistBlock}。
   *
   * @deprecated 新代码请使用 {@link materializeLiveView} / {@link materializePersistBlock}。
   */
  materialize(): Promise<WorkplaceMaterialized>;

  /** 消费方 ①：实时列表 + 宏树（无缓存，并发调用合并为单次 metadata）。 */
  materializeLiveView(): Promise<WorkplaceLiveView>;

  /** 消费方 ②：仅持久 workplace 块（供快照缓存与提示词）。 */
  materializePersistBlock(): Promise<WorkplacePersistBlock>;

  /**
   * 评估规则视图（不含文件正文）。
   * 供常驻工作区 assemble 在空 `rule_snapshot` 时写入快照。
   */
  evaluateRuleView(): Promise<WorkplaceRuleView>;

  /** 工作区列表行（委托 {@link materializeLiveView}）。 */
  buildListRows(): Promise<WorkplaceListRow[]>;

  /**
   * 持久 workplace 块（委托 {@link materializePersistBlock}：直读 VFS 的 live materialize）。
   *
   * **聊天常驻前缀**请用 {@link assembleWorkplaceDisplay}（session kkv），勿与本方法混用。
   * CLI：仅 `vfs|project workplace display`（无 session）走此路径；`session workplace display` 走 assemble。
   */
  renderDisplay(): Promise<string>;

  /** `{{$filetree}}` 宏树（委托 {@link materializeLiveView}）。 */
  renderFileTree(): Promise<string>;
}
