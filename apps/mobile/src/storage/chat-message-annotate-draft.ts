/**
 * Mobile 入口：消息正文批注草稿 store 在 `@novel-master/core/chat`（与文件批注硬分离）。
 * 禁止写入 chipsFromAnnotateStore / 气泡下划线。
 */
export {
  addChatMessageAnnotateDraft,
  clearChatMessageAnnotateDrafts,
  hasChatMessageAnnotateDrafts,
  listChatMessageAnnotateDrafts,
  removeChatMessageAnnotateDraft,
  resetChatMessageAnnotateDraftStoreForTests,
  subscribeChatMessageAnnotateDraft,
  updateChatMessageAnnotateDraft,
} from '@novel-master/core/chat';
