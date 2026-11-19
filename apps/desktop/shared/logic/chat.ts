/**
 * Desktop renderer 对 `@novel-master/core/chat` 的具名薄再导出。
 * 禁止 `export *`；禁止 create*Service 等 runtime 工厂。
 *
 * 类型优先用 `@shared/ipc-types` DTO（如 `ChatMessageDto` / `ContentBlockDto` /
 * `AnnotateDraftDto` / `MessageAttachmentDto`）；下列 domain 类型供迁移过渡。
 */

export type {
  AnnotateDraft,
  AtPathRef,
  ChatMessageData,
  ComposerDraftTokenRange,
  ContentBlock,
  MessageAttachment,
} from "@novel-master/core/chat";
export type { RollbackMode } from "@novel-master/core/presentation/chat/rollback-confirm.js";

export {
  ChatMessage,
  chatAnnotateDraftStore,
  chatLinkResolver,
  composerAtPath,
  attachmentXmlCodec,
  ComposerDraftSchema,
  composerChips,
  composerSendPolicy,
  skillToolRefResolver,
  VfsToolFilePath,
  attachmentScanner,
  MessageMetadata,
  TextBlocks,
  USER_VFS_TURN_ACK_TEXT,
  userVfsTurnStorage,
} from "@novel-master/core/chat";
export { ToolSummary } from "@novel-master/core/presentation/chat/tool-summary.js";
export { AttachmentChip } from "@novel-master/core/presentation/chat/attachment-chip.js";
export { rollbackConfirm } from "@novel-master/core/presentation/chat/rollback-confirm.js";
