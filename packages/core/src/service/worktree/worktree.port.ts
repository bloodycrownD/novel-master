/**
 * Worktree application service port.
 *
 * @module service/worktree/worktree.port
 */

import type {
  SetDirRuleInput,
  SetFileRuleInput,
  WorktreeDirRule,
  WorktreeListRow,
  WorktreeScope,
} from "@/domain/worktree/model/worktree-types.js";

/** 消费方 ①：工作区列表 + `{{$filetree}}` 宏，单次元数据遍历产出。 */
export interface WorktreeLiveView {
  readonly listRows: readonly WorktreeListRow[];
  readonly filetreeDisplay: string;
}

/** 消费方 ②：提示词持久 worktree 块（不含列表与宏树）。 */
export interface WorktreePersistBlock {
  readonly worktreeDisplay: string;
}

/**
 * 向后兼容：列表 + 持久块 + 宏树。
 *
 * @deprecated 使用 {@link WorktreeLiveView} / {@link WorktreePersistBlock}。
 */
export interface WorktreeMaterialized {
  readonly listRows: readonly WorktreeListRow[];
  readonly worktreeDisplay: string;
  readonly filetreeDisplay: string;
}

/** Worktree configuration and display operations for one VFS scope. */
export interface WorktreeService {
  readonly scope: WorktreeScope;

  setDirRule(input: SetDirRuleInput): Promise<void>;

  getDirRule(logicalPath: string): Promise<WorktreeDirRule | undefined>;

  setFileRule(input: SetFileRuleInput): Promise<void>;

  /** 删除路径及其子路径下的 worktree 纳入/目录规则（VFS 删除后清理 Explorer 幽灵目录）。 */
  deleteRulesUnderLogicalPrefix(logicalPrefix: string): Promise<void>;

  /**
   * 向后兼容：组合 {@link materializeLiveView} 与 {@link materializePersistBlock}。
   *
   * @deprecated 新代码请使用 {@link materializeLiveView} / {@link materializePersistBlock}。
   */
  materialize(): Promise<WorktreeMaterialized>;

  /** 消费方 ①：实时列表 + 宏树（无缓存，并发调用合并为单次 metadata）。 */
  materializeLiveView(): Promise<WorktreeLiveView>;

  /** 消费方 ②：仅持久 worktree 块（供快照缓存与提示词）。 */
  materializePersistBlock(): Promise<WorktreePersistBlock>;

  /** 工作区列表行（委托 {@link materializeLiveView}）。 */
  buildListRows(): Promise<WorktreeListRow[]>;

  /** 持久 worktree 块（委托 {@link materializePersistBlock}）。 */
  renderDisplay(): Promise<string>;

  /** `{{$filetree}}` 宏树（委托 {@link materializeLiveView}）。 */
  renderFileTree(): Promise<string>;
}
