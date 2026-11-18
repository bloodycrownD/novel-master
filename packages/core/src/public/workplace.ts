export type {
  WorkplaceScope,
  RuleState,
  InclusionMode,
  DisplayState,
  SortField,
  SortOrder,
  FillPolicy,
  WorkplaceRuleRow,
  WorkplaceDirRuleRow,
  WorkplaceFileRuleRow,
  WorkplaceListRow,
  WorkplaceDirRule,
  SetDirRuleInput,
  SetFileRuleInput,
} from "../domain/workplace/model/workplace-types.js";
export type {
  WorkplaceRuleContext,
  WorkplaceRuleView,
} from "../domain/workplace/model/workplace-rule-view.js";
export { evaluateWorkplaceRuleView } from "../domain/workplace/logic/workplace-rule-engine.js";
export {
  mapProjectWorkplacePathToSession,
  mapSessionWorkplacePathToProject,
} from "../domain/workplace/logic/workplace-path-map.js";
export {
  evaluateFileDisplay,
  computeHeadTailIndices,
  sortDirPaths,
  sortFilesForDir,
} from "../domain/workplace/logic/workplace-eval.js";
export { DEFAULT_WORKPLACE_DIR_RULE } from "../domain/workplace/logic/default-dir-rule.js";
export {
  ruleStateLabel,
  inclusionModeLabel,
  displayStateLabel,
  filetreeMacroLoadStateLabel,
} from "../domain/workplace/logic/workplace-labels.js";
export {
  renderFileBlock,
  renderFileBlockBody,
  joinFileBlocks,
  formatLocalMtime,
} from "../domain/workplace/logic/workplace-display.js";
export {
  renderWorkplaceFileTree,
  workplaceFileTreeRootLabel,
} from "../domain/workplace/logic/workplace-file-tree.js";
export { parseMarkdownFrontMatter } from "../domain/workplace/logic/front-matter.js";
// split / 类型真源已收到 common/front-matter.ts（workplace 只是历史公开路径）；
// 这里只改转发来源，公开符号名与 allowlist 快照不变。
export { splitMarkdownFrontMatter, type MarkdownFrontMatterSplit } from "../common/front-matter.js";
export { createWorkplaceService } from "../service/workplace/create-workplace-service.js";
export type {
  WorkplaceService,
  WorkplaceMaterialized,
  WorkplaceLiveView,
  WorkplacePersistBlock,
} from "../service/workplace/workplace.port.js";
export { createTemplatePullService } from "../service/template/create-template-pull-service.js";
export type { TemplatePullService } from "../service/template/template-pull.port.js";
export {
  assembleWorkplaceDisplay,
  type AssembleWorkplaceDisplayDeps,
  type AssembleWorkplaceDisplayResult,
  type AssembleWorkplaceDisplayOptions,
} from "../service/workplace/assemble-workplace-display.js";
// 控制流结果类型（错误通道迁移二期）：组装中止改沿 Outcome.cancelled/replaced
// 返回，apps build 侧按 kind 判定收口，不再 catch 哨兵类。
export type { Interrupt, Outcome } from "../errors/outcome.js";
export { layoutHasWorkplace } from "../domain/prompt/model/agent-prompt-layout.js";
export {
  refreshRuleSnapshot,
  type RefreshRuleSnapshotDeps,
} from "../service/workplace/refresh-rule-snapshot.js";
export {
  ruleViewToSnapshotEntries,
  parseRuleSnapshotJson,
  serializeRuleSnapshot,
  type RuleSnapshotEntry,
} from "../domain/workplace/logic/rule-snapshot-codec.js";
export {
  diffWorkplacePaths,
  isWorkplacePathLoadedInCache,
  type WorkplaceLivePath,
} from "../domain/workplace/logic/diff-workplace-paths.js";
export { workplaceRootLogicalPath } from "../domain/workplace/logic/workplace-scope.js";
