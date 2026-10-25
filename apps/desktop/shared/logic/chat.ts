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
  RollbackMode,
} from "@novel-master/core/chat";

export {
  ChatMessage,
  chatAnnotateDraftStore,
  chatLinkResolver,
  summarizeToolInput,
  composerAtPath,
  attachmentXmlCodec,
  formatStatusChipLabelFromAttachment,
  parseComposerDraftJson,
  composerChips,
  composerSendPolicy,
  rollbackConfirm,
  skillToolRefResolver,
  resolveVfsToolFilePath,
  attachmentScanner,
  serializeComposerDraftJson,
  USER_VFS_TURN_ACK_TEXT,
  userVfsTurnStorage,
} from "@novel-master/core/chat";
