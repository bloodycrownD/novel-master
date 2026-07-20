/**
 * Mobile 入口：批注草稿 store 在 `@novel-master/core/chat`（双端共用）。
 */
export {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  removeChatAnnotateDraft,
  removeChatAnnotateDraftsByPath,
  resetChatAnnotateDraftStoreForTests,
  subscribeChatAnnotateDraft,
  unionComposerStatusWithAnnotate,
  updateChatAnnotateDraft,
} from '@novel-master/core/chat';
