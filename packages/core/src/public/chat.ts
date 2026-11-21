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
  MessageAttachmentSchema,
  messageAttachmentSchema,
  messageAttachmentsSchema,
} from "../domain/chat/model/message-attachment.schema.js";
export type { MessageAttachmentAction } from "../domain/chat/model/message-attachment.schema.js";
export { AnnotateDraftSchema } from "../domain/chat/model/annotate-draft.schema.js";
export type {
  AnnotateDraft,
  SendAnnotateDraft,
} from "../domain/chat/model/annotate-draft.schema.js";
export { ComposerDraftSchema } from "../domain/chat/model/composer-draft.schema.js";
export type {
  ComposerDraft,
  /** Composer 草稿中的确认胶囊区间（`[start, end)`，UTF-16 码元偏移）。 */
  ComposerDraftTokenRange,
} from "../domain/chat/model/composer-draft.schema.js";
export {
  ATTACH_PROMPT_CHAR_BUDGET,
} from "../domain/chat/logic/attachment/attach-budget.js";
export { UserMessageFormatter } from "../domain/chat/logic/prompt/user-message-formatter.js";
export { PromptAssembler } from "../domain/chat/logic/prompt/prompt-assembler.js";
export { attachmentPath } from "../domain/chat/logic/message/attachment-path.js";
export { AttachmentXmlCodec } from "../domain/chat/logic/attachment/attachment-xml-codec.js";
export { promptPathSeen } from "../domain/chat/logic/attachment/prompt-path-seen.js";
export { AttachmentScanner } from "../domain/chat/logic/attachment/attachment-scanner.js";
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
export { TextBlocks } from "../domain/chat/content/text-blocks.js";
export { MessageContentParse } from "../domain/chat/content/parse-message-content.js";
export { MessageCliFormat } from "../domain/chat/content/format-message-cli.js";
export { MessageMetadata } from "../domain/chat/model/message-metadata.js";
export { ChatLinkResolver } from "../domain/chat/logic/resolve-chat-link-target.js";
export { ComposerSendPolicy } from "../domain/chat/logic/composer/composer-send-policy.js";
export { composerChips } from "../domain/chat/logic/composer/composer-chips.js";
export { composerAtPath } from "../domain/chat/logic/composer/composer-at-path.js";
export type { AtPathRef } from "../domain/chat/logic/composer/composer-at-path.js";
export { chatAnnotateDraftStore } from "../domain/chat/logic/chat-annotate-draft-store.js";
export {
  USER_VFS_TURN_ACK_TEXT,
  userVfsTurnStorage,
} from "../domain/chat/logic/vfs-turn/user-vfs-turn-constants.js";
export { ChatMessage } from "../domain/chat/logic/message/chat-message.js";
export type { ChatMessageDescriptor, ChatMessageKey } from "../domain/chat/i18n/keys.js";
export { ChatServiceFactory } from "../service/chat/chat-service-factory.js";
export type { ChatServicesSessionDeps } from "../service/chat/chat-service-factory.js";
// 归属例外（check-public-ownership）：VFS 工具卡路径解析，desktop/mobile
// 的 transcript 消费方都在 chat 门面取（domain/tool 无独立出口）。
export { VfsToolFilePath } from "../domain/tool/logic/vfs-tool-file-path.js";
export { SkillToolRefResolver } from "../domain/chat/logic/skill-tool-ref.js";
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
// chat 域展示层（domain/chat/presentation；原 presentation/chat 顶级层降级并入）。
export {ToolSummary} from "../domain/chat/presentation/tool-summary.js";
export {AttachmentChip} from "../domain/chat/presentation/attachment-chip.js";
export type {StatusChipLabelOptions} from "../domain/chat/presentation/attachment-chip.js";
export type {AttachmentChipDescriptor} from "../domain/chat/presentation/attachment-chip.js";
export {CHIP_TEMPLATE_KEY, CHIP_BARE_KEY} from "../domain/chat/presentation/chip-keys.js";
export {RollbackConfirmView} from "../domain/chat/presentation/rollback-confirm.js";
export type {
  RollbackMode,
  RollbackConfirmKind,
  RollbackConfirmDescriptor,
} from "../domain/chat/presentation/rollback-confirm.js";
