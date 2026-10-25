export { ChatError } from "../errors/chat-errors.js";
export type { ChatErrorCode } from "../errors/chat-errors.js";
export type { ChatProject } from "../domain/chat/model/project.js";
export type {
  ProjectAgentConfig,
  ProjectAgentConfigPatch,
  ProjectAgentMode,
} from "../domain/chat/model/project-agent-config.js";
export { DEFAULT_PROJECT_AGENT_CONFIG } from "../domain/chat/model/project-agent-config.js";
export {
  projectAgentConfigSchema,
  projectAgentModeSchema,
} from "../domain/chat/model/project-agent-config.schema.js";
export type { ChatSession } from "../domain/chat/model/session.js";
export type {
  SessionAgentConfig,
  SessionAgentConfigPatch,
} from "../domain/chat/model/session-agent-config.js";
export { sessionAgentConfigSchema } from "../domain/chat/model/session-agent-config.schema.js";
export type {
  ChatMessage,
  MessageAttachment,
  MessageContent,
} from "../domain/chat/model/message.js";
export {
  NO_PATH_ATTACHMENT_NAME,
  attachmentStorageName,
  messageAttachmentActionSchema,
  messageAttachmentSchema,
  messageAttachmentsSchema,
  parseAttachmentsJson,
  serializeAttachmentsJson,
} from "../domain/chat/model/message-attachment.schema.js";
export type { MessageAttachmentAction } from "../domain/chat/model/message-attachment.schema.js";
export {
  annotateDraftSchema,
  annotateDraftsSchema,
  isMessageAnnotatePath,
  MESSAGE_ANNOTATE_PATH_MARKER,
} from "../domain/chat/model/annotate-draft.schema.js";
export type {
  AnnotateDraft,
  AnnotateDrafts,
  SendAnnotateDraft,
} from "../domain/chat/model/annotate-draft.schema.js";
export {
  EMPTY_COMPOSER_DRAFT,
  composerDraftAttachmentSchema,
  composerDraftSchema,
  isComposerDraftAttachment,
  parseComposerDraftJson,
  serializeComposerDraftJson,
} from "../domain/chat/model/composer-draft.schema.js";
export type {
  ComposerDraft,
  ComposerDraftAttachment,
  /** Composer 草稿中的确认胶囊区间（`[start, end)`，UTF-16 码元偏移）。 */
  ComposerDraftTokenRange,
} from "../domain/chat/model/composer-draft.schema.js";
export {
  ATTACH_PROMPT_CHAR_BUDGET,
} from "../domain/chat/logic/attach-budget.js";
export { wrapUserMessageForLlm } from "../domain/chat/logic/wrap-user-message-for-llm.js";
export { prepareUserMessagesForPrompt } from "../domain/chat/logic/prepare-user-messages-for-prompt.js";
export type { PrepareUserMessagesForPromptRuntime } from "../domain/chat/logic/prepare-user-messages-for-prompt.js";
export {
  STATUS_CHIP_ZH,
  formatStatusChipLabel,
  formatStatusChipLabelFromAttachment,
  logicalParentDir,
  renameChipZh,
  resolveRenameOrMoveAction,
} from "../domain/chat/logic/status-chip-label.js";
export {
  buildFileAnnotateAttachmentFromDraft,
  parseAnnotateDraftsFromAttachments,
} from "../domain/chat/logic/build-attachment-action-xml.js";
export {
  PROMPT_FILE_SEEN_SHORT_TIP,
  createPromptPathSeenSet,
  isPromptDirTokenPath,
  normalizePromptSeenPath,
  normalizePromptStorePath,
  tryNormalizePromptSeenPath,
} from "../domain/chat/logic/prompt-path-seen.js";
export {
  ATTACH_DIR_TREE_MAX_UTF8_BYTES,
  renderDirAttachTree,
} from "../domain/chat/logic/render-dir-attach-tree.js";
export type { RenderDirAttachTreeDeps } from "../domain/chat/logic/render-dir-attach-tree.js";
export {
  mergeAttachmentsByPath,
  mergeAttachmentsWithScannedAtPaths,
  scanAtPathAttachments,
} from "../domain/chat/logic/scan-at-path-attachments.js";
export {
  mergeAttachmentsWithScannedSkills,
  scanSkillAttachments,
  skillSeenKey,
} from "../domain/chat/logic/scan-skill-attachments.js";
export type {
  ContentBlock,
  TextBlock,
  ImageBlock,
  ImageSource,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
} from "../domain/chat/model/content-block.js";
export { textBlocks } from "../domain/chat/content/text-blocks.js";
export {
  parseMessageContent,
  parseMessageContentValue,
} from "../domain/chat/content/parse-message-content.js";
export { formatMessageForCli } from "../domain/chat/content/format-message-cli.js";
export type {
  MessageMetadata,
  MessageMetadataKind,
} from "../domain/chat/model/message-metadata.js";
export { readMessageMetadata } from "../domain/chat/model/message-metadata.js";
export {
  userVfsPendingEntrySchema,
  userVfsPendingQueueSchema,
  userVfsPendingToolSchema,
} from "../domain/chat/model/user-vfs-pending.schema.js";
export type {
  UserVfsPendingEntry,
  UserVfsPendingQueue,
  UserVfsPendingTool,
} from "../domain/chat/model/user-vfs-pending.schema.js";
export { resolveChatLinkTarget, isHttpUrl, elideChatLinkPath, chatLinkNotFoundMessage } from "../domain/chat/logic/resolve-chat-link-target.js";
export { mergePendingVfsTurns } from "../domain/chat/logic/merge-pending-vfs-turns.js";
export type { MergedPendingVfsTurn } from "../domain/chat/logic/merge-pending-vfs-turns.js";
export type { WorkspaceFlushSnapshot } from "../domain/chat/logic/workspace-flush-snapshot.js";
export {
  deriveDirPathsFromFileTree,
  emptyWorkspaceFlushSnapshot,
} from "../domain/chat/logic/workspace-flush-snapshot.js";
export { resolveComposerSendIntent } from "../domain/chat/logic/composer-send-intent.js";
export {
  partitionComposerChipAttachments,
} from "../domain/chat/logic/composer-chip-attachment.js";
export {
  atPathTokensFromPickerSelection,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
} from "../domain/chat/logic/composer-at-path.js";
export type { AtPathRef } from "../domain/chat/logic/composer-at-path.js";
export { chatAnnotateDraftStore } from "../domain/chat/logic/chat-annotate-draft-store.js";
export {
  USER_VFS_TURN_ACK_TEXT,
  wrapUserVfsActionsForStorage,
} from "../domain/chat/logic/user-vfs-turn-constants.js";
export {
  buildUserVfsTurnView,
  deriveToolUsesFromVfsActions,
  formatUserVfsTurnPreviewBody,
  matchUserVfsTurnAt,
  parseAllUserVfsActionsFromText,
  USER_VFS_TURN_SPAN,
} from "../domain/chat/logic/user-vfs-turn-view.js";
export type {
  ParsedUserVfsAction,
  ParsedUserVfsEditHunk,
  UserVfsTurnView,
} from "../domain/chat/logic/user-vfs-turn-view.js";
export {
  hasAnnotateAttachment,
  hasToolResult,
  isPlainUserText,
} from "../domain/chat/logic/message-content-helpers.js";
export {
  extractEditableTextFromMessage,
  isPlainUserUndoSendEligible,
} from "../domain/chat/logic/editable-text-from-message.js";
export { resolveRollbackConfirmMessage } from "../domain/chat/logic/rollback-confirm-copy.js";
export type {
  RollbackConfirmKind,
  RollbackMode,
} from "../domain/chat/logic/rollback-confirm-copy.js";
export type {
  MessageVisibilityBatchMode,
  TranscriptSelectableRole,
  VisibilityBatchMessage,
} from "../domain/chat/logic/visibility-batch-range.js";
export {
  transcriptSelectableRole,
  isTranscriptRowSelectable,
  computeHideRangeFromSelection,
  computeShowRangeFromSelection,
  computeVisibilityBatchAffectedIds,
  selectVisibilityBatchEligibleIdsFromAnchor,
} from "../domain/chat/logic/visibility-batch-range.js";
export {
  computeSetFloorRanges,
  isSetFloorAnchorRole,
} from "../domain/chat/logic/message-set-floor-range.js";
export type {
  TailBatchMode,
  TailBatchRow,
} from "../domain/chat/logic/tail-batch-range.js";
export {
  isTailBatchRowSelectable,
  selectTailBatchEligibleIdsFromAnchor,
  computeTailBatchAffectedIds,
  computeTailBatchRangeFromSelection,
  tailBatchDeleteAfterSeq,
} from "../domain/chat/logic/tail-batch-range.js";
export {
  listVisibleSorted,
  visibleFloorByMessageId,
} from "../domain/chat/logic/message-visible-floor.js";
export {
  createChatServices,
  createProjectService,
  createSessionService,
  createMessageService,
  createUsageStatsService,
} from "../service/chat/create-chat-services.js";
export type {
  ChatServiceBundle,
  ChatServicesSessionDeps,
} from "../service/chat/create-chat-services.js";
export {
  createUserVfsTurnService,
  createUserVfsTurnServiceBundle,
} from "../service/chat/create-user-vfs-turn-service.js";
export type { UserVfsTurnServiceBundle } from "../service/chat/create-user-vfs-turn-service.js";
export { resolveVfsToolFilePath } from "../domain/tool/logic/vfs-tool-file-path.js";
export { resolveSkillToolRefFromInput } from "../domain/chat/logic/skill-tool-ref.js";
export type { SkillToolRef } from "../domain/chat/model/content-block.js";
export type {
  UserVfsTurnService,
  UserVfsTurnOp,
  UserVfsTurnToolSpec,
  UserVfsTurnExecuteResult,
} from "../service/chat/user-vfs-turn.port.js";
export type { ProjectService } from "../service/chat/project.port.js";
export type { SessionService } from "../service/chat/session.port.js";
export type { MessageService } from "../service/chat/message.port.js";
export type {
  UsageStatsService,
  UsageStatsRange,
  UsageStatsFilter,
  UsageStatsSummary,
  UsageStatsBucket,
  UsageStatsModelRow,
  UsageStatsRequestRow,
  UsageStatsRequestPage,
  UsageStatsRequestPageQuery,
  SessionUsageDetail,
  SessionUsageLastRequest,
} from "../service/chat/usage-stats.port.js";
export type {
  MessageTranscriptEffectsService,
  SetMessageFloorResult,
} from "../service/chat/message-transcript-effects.port.js";
export { createMessageTranscriptEffectsService } from "../service/chat/create-message-transcript-effects.js";
export { summarizeToolInput } from "../domain/chat/logic/tool-summary.js";
