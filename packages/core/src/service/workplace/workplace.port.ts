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

  setFileRule(input: SetFileRuleInput): Promise<void>;

  /** 删除路径及其子路径下的 workplace 纳入/目录规则（VFS 删除后清理 Explorer 幽灵目录）。 */
  deleteRulesUnderLogicalPrefix(logicalPrefix: string): Promise<void>;

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
