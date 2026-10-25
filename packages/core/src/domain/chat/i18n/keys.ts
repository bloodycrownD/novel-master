/**
 * Chat 域消息 key 契约。
 *
 * 文案本体在 `packages/core/locales/chat.<locale>.json`；本文件只定义 key 与
 * descriptor 类型，不包含任何用户可见文本。
 *
 * @module domain/chat/i18n/keys
 */

import type { MessageDescriptor, MessageLike } from "@/common/i18n.js";

export const CHAT_MESSAGE_KEYS = [
  "chat.rollback.confirm.primary.undo_send",
  "chat.rollback.confirm.primary.rewind",
  "chat.rollback.confirm.degraded.undo_send",
  "chat.rollback.confirm.degraded.rewind",
  "chat.rollback.confirm.backfill",
  "chat.rollback.confirm.backfill.file",
  "chat.rollback.confirm.backfill.file.empty",
  "chat.rollback.confirm.backfill.tail.undo_send",
  "chat.rollback.confirm.backfill.tail.rewind",
] as const;

export type ChatMessageKey = (typeof CHAT_MESSAGE_KEYS)[number];
export type ChatMessageDescriptor = MessageDescriptor<ChatMessageKey>;
export type ChatMessageLike = MessageLike<ChatMessageKey>;
