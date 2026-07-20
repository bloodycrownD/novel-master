/**
 * Mobile 入口：`@路径` 共享纯函数在 `@novel-master/core/chat`。
 * mention 专属见 `composer-at-path-mention.ts`（禁止进 core）。
 */
export {
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
  type AtPathRef,
} from '@novel-master/core/chat';
