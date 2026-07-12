export { ChatError } from '../errors/chat-errors.js';
export type { ChatErrorCode } from '../errors/chat-errors.js';
export type { ChatProject } from '../domain/chat/model/project.js';
export type {
  ProjectAgentConfig,
  ProjectAgentConfigPatch,
  ProjectAgentMode,
} from '../domain/chat/model/project-agent-config.js';
export {
  DEFAULT_PROJECT_AGENT_CONFIG,
  PROJECT_AGENT_META_DISPLAY_LABEL,
} from '../domain/chat/model/project-agent-config.js';
export {
  projectAgentConfigSchema,
  projectAgentModeSchema,
} from '../domain/chat/model/project-agent-config.schema.js';
export type { ChatSession } from '../domain/chat/model/session.js';
export type {
  ChatMessage,
  MessageContent,
} from '../domain/chat/model/message.js';
export type {
  ContentBlock,
  TextBlock,
  ImageBlock,
  ImageSource,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
} from '../domain/chat/model/content-block.js';
export { textBlocks } from '../domain/chat/content/text-blocks.js';
export {
  parseMessageContent,
  assertMessageContent,
} from '../domain/chat/content/parse-message-content.js';
export { formatMessageForCli } from '../domain/chat/content/format-message-cli.js';
export type {
  MessageMetadata,
  MessageMetadataKind,
} from '../domain/chat/model/message-metadata.js';
export { readMessageMetadata } from '../domain/chat/model/message-metadata.js';
export {
  userVfsPendingEntrySchema,
  userVfsPendingQueueSchema,
  userVfsPendingToolSchema,
} from '../domain/chat/model/user-vfs-pending.schema.js';
export type {
  UserVfsPendingEntry,
  UserVfsPendingQueue,
  UserVfsPendingTool,
} from '../domain/chat/model/user-vfs-pending.schema.js';
export {
  computeStreamTailGenerating,
  DEFAULT_STREAM_TAIL_IDLE_MS,
} from '../domain/chat/logic/compute-stream-tail-generating.js';
export { mergePendingVfsTurns } from '../domain/chat/logic/merge-pending-vfs-turns.js';
export type { MergedPendingVfsTurn } from '../domain/chat/logic/merge-pending-vfs-turns.js';
export type { WorkspaceFlushSnapshot } from '../domain/chat/logic/workspace-flush-snapshot.js';
export {
  deriveDirPathsFromFileTree,
  emptyWorkspaceFlushSnapshot,
} from '../domain/chat/logic/workspace-flush-snapshot.js';
export { resolveFlushBaselineTree } from '../domain/chat/logic/resolve-flush-baseline-tree.js';
export { resolveCurrentWorkspaceSnapshot } from '../domain/chat/logic/resolve-current-workspace-snapshot.js';
export {
  diffWorkspaceForUserVfsFlush,
  isWorkspaceFlushDiffEmpty,
} from '../domain/chat/logic/diff-workspace-for-user-vfs-flush.js';
export type {
  WorkspaceFlushDiff,
  WorkspaceFlushDiffInput,
  WorkspaceFlushChangedFile,
  WorkspaceFlushAddedFile,
} from '../domain/chat/logic/diff-workspace-for-user-vfs-flush.js';
export { synthesizeUserVfsFlushActions } from '../domain/chat/logic/synthesize-user-vfs-flush-actions.js';
export {
  USER_VFS_TURN_ACK_TEXT,
  wrapUserVfsActionsForStorage,
} from '../domain/chat/logic/user-vfs-turn-constants.js';
export {
  buildUserVfsTurnView,
  deriveToolUsesFromVfsActions,
  formatUserVfsTurnPreviewBody,
  matchUserVfsTurnAt,
  matchUserVfsTurnAtForDisplay,
  parseAllUserVfsActionsFromText,
  USER_VFS_TURN_SPAN,
} from '../domain/chat/logic/user-vfs-turn-view.js';
export type {
  ParsedUserVfsAction,
  ParsedUserVfsEditHunk,
  UserVfsTurnView,
} from '../domain/chat/logic/user-vfs-turn-view.js';
export {
  hasToolResult,
  isPlainUserText,
} from '../domain/chat/logic/message-content-helpers.js';
export {
  extractEditableTextFromMessage,
  isPlainUserUndoSendEligible,
} from '../domain/chat/logic/editable-text-from-message.js';
export {
  resolveRollbackConfirmMessage,
} from '../domain/chat/logic/rollback-confirm-copy.js';
export type {
  RollbackConfirmKind,
  RollbackMode,
} from '../domain/chat/logic/rollback-confirm-copy.js';
export type {
  MessageVisibilityBatchMode,
  TranscriptSelectableRole,
  VisibilityBatchMessage,
} from '../domain/chat/logic/visibility-batch-range.js';
export {
  transcriptSelectableRole,
  isTranscriptRowSelectable,
  computeHideRangeFromSelection,
  computeShowRangeFromSelection,
  computeVisibilityBatchAffectedIds,
  selectVisibilityBatchEligibleIdsFromAnchor,
} from '../domain/chat/logic/visibility-batch-range.js';
export {
  computeSetFloorRanges,
  isSetFloorAnchorRole,
} from '../domain/chat/logic/message-set-floor-range.js';
export type {
  TailBatchMode,
  TailBatchRow,
} from '../domain/chat/logic/tail-batch-range.js';
export {
  isTailBatchRowSelectable,
  selectTailBatchEligibleIdsFromAnchor,
  computeTailBatchAffectedIds,
  computeTailBatchRangeFromSelection,
  tailBatchDeleteAfterSeq,
} from '../domain/chat/logic/tail-batch-range.js';
export {
  listVisibleSorted,
  visibleFloorByMessageId,
} from '../domain/chat/logic/message-visible-floor.js';
export {
  createProjectService,
  createSessionService,
  createMessageService,
} from '../service/chat/create-chat-services.js';
export {
  createUserVfsTurnService,
  createUserVfsTurnServiceBundle,
} from '../service/chat/create-user-vfs-turn-service.js';
export type { UserVfsTurnServiceBundle } from '../service/chat/create-user-vfs-turn-service.js';
export { TOOL_TURN_BRIDGE_TEXT } from '../service/chat/impl/append-tool-turn-bridge.js';
export { resolveVfsToolFilePath } from '../domain/tool/logic/vfs-tool-file-path.js';
export type {
  UserVfsTurnService,
  UserVfsTurnOp,
  UserVfsTurnToolSpec,
  UserVfsTurnExecuteResult,
  UserVfsFlushResult,
  AppendToolTurnBridgeFn,
} from '../service/chat/user-vfs-turn.port.js';
export type { ProjectService } from '../service/chat/project.port.js';
export type { SessionService } from '../service/chat/session.port.js';
export type { MessageService } from '../service/chat/message.port.js';
export type {
  MessageTranscriptEffectsService,
  SetMessageFloorResult,
} from '../service/chat/message-transcript-effects.port.js';
export { createMessageTranscriptEffectsService } from '../service/chat/create-message-transcript-effects.js';
