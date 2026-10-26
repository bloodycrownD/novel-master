export type { ChatProject } from "../domain/chat/model/project.js";
export type {
  ProjectAgentConfig,
  ProjectAgentConfigPatch,
  ProjectAgentMode,
} from "../domain/chat/model/project-agent-config.js";
export type { ChatSession } from "../domain/chat/model/session.js";
export type {
  SessionAgentConfig,
  SessionAgentConfigPatch,
} from "../domain/chat/model/session-agent-config.js";
/** package-exports-t0 明确断言的公共契约，不随 fake-public 清理删除。 */
export { sessionAgentConfigSchema } from "../domain/chat/model/session-agent-config.schema.js";
export type {
  ChatMessageData,
  MessageAttachment,
  MessageContent,
} from "../domain/chat/model/message.js";
export {
  attachmentStorageName,
  messageAttachmentSchema,
  messageAttachmentsSchema,
  parseAttachmentsJson,
} from "../domain/chat/model/message-attachment.schema.js";
export type { MessageAttachmentAction } from "../domain/chat/model/message-attachment.schema.js";
export { isMessageAnnotatePath } from "../domain/chat/model/annotate-draft.schema.js";
export type {
  AnnotateDraft,
  SendAnnotateDraft,
} from "../domain/chat/model/annotate-draft.schema.js";
export {
  parseComposerDraftJson,
  serializeComposerDraftJson,
} from "../domain/chat/model/composer-draft.schema.js";
export type {
  ComposerDraft,
  /** Composer 草稿中的确认胶囊区间（`[start, end)`，UTF-16 码元偏移）。 */
  ComposerDraftTokenRange,
} from "../domain/chat/model/composer-draft.schema.js";
export {
  ATTACH_PROMPT_CHAR_BUDGET,
} from "../domain/chat/logic/attachment/attach-budget.js";
export { userMessageFormatter } from "../domain/chat/logic/prompt/user-message-formatter.js";
export { promptAssembler } from "../domain/chat/logic/prompt/prompt-assembler.js";
export { attachmentPath } from "../domain/chat/logic/message/attachment-path.js";
export { formatStatusChipLabel, formatStatusChipLabelFromAttachment } from "../presentation/chat/attachment-chip.js";
export { attachmentXmlCodec } from "../domain/chat/logic/attachment/attachment-xml-codec.js";
export { promptPathSeen } from "../domain/chat/logic/attachment/prompt-path-seen.js";
export { attachmentScanner, AttachmentPathArgumentError } from "../domain/chat/logic/attachment/attachment-scanner.js";
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
export { readMessageMetadata } from "../domain/chat/model/message-metadata.js";
export { chatLinkResolver } from "../domain/chat/logic/resolve-chat-link-target.js";
export { composerSendPolicy } from "../domain/chat/logic/composer/composer-send-policy.js";
export { composerChips } from "../domain/chat/logic/composer/composer-chips.js";
export { composerAtPath } from "../domain/chat/logic/composer/composer-at-path.js";
export type { AtPathRef } from "../domain/chat/logic/composer/composer-at-path.js";
export { chatAnnotateDraftStore } from "../domain/chat/logic/chat-annotate-draft-store.js";
export {
  USER_VFS_TURN_ACK_TEXT,
  userVfsTurnStorage,
} from "../domain/chat/logic/vfs-turn/user-vfs-turn-constants.js";
export { ChatMessage } from "../domain/chat/logic/message/chat-message.js";
export { rollbackConfirm } from "../presentation/chat/rollback-confirm.js";
export type { RollbackConfirmDescriptor, RollbackConfirmKind, RollbackMode } from "../presentation/chat/rollback-confirm.js";
export type { ChatMessageDescriptor, ChatMessageKey, ChatMessageLike } from "../domain/chat/i18n/keys.js";
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
export { skillToolRefResolver } from "../domain/chat/logic/skill-tool-ref.js";
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
export { summarizeToolInput } from "../presentation/chat/tool-summary.js";
