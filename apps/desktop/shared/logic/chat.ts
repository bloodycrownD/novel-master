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
  ChatMessage,
  ComposerDraftTokenRange,
  ContentBlock,
  MessageAttachment,
  RollbackMode,
} from "@novel-master/core/chat";

export {
  ChatMessageEntity,
  chatAnnotateDraftStore,
  chatLinkNotFoundMessage,
  isHttpUrl,
  resolveChatLinkTarget,
  summarizeToolInput,
  atPathTokensFromPickerSelection,
  buildFileAnnotateAttachmentFromDraft,
  findActiveAtQuery,
  formatComposerAtPathToken,
  formatStatusChipLabelFromAttachment,
  parseAnnotateDraftsFromAttachments,
  parseComposerDraftJson,
  partitionComposerChipAttachments,
  replaceActiveAtWithToken,
  resolveComposerSendIntent,
  rollbackConfirmDescriptor,
  resolveSkillToolRefFromInput,
  resolveVfsToolFilePath,
  scanAtPathAttachments,
  serializeComposerDraftJson,
  USER_VFS_TURN_ACK_TEXT,
  wrapUserVfsActionsForStorage,
} from "@novel-master/core/chat";
