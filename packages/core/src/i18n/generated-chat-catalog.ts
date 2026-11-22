/**
 * 自动生成：scripts/gen-i18n-catalog.mjs 从 src/i18n/catalog/*.yaml 生成，勿手改。
 * 键序固定 zh-CN 在前（localeRule 的对象键序约束：同语言前缀回退依赖键序）。
 * zh-CN 全量（satisfies 即全集断言）；en-US 为部分骨架（缺 key 由回退链落 zh-CN）。
 *
 * @module i18n/generated-chat-catalog
 */

import type { MessageCatalog } from "@/common/i18n.js";
import type { ChatMessageKey } from "@/domain/chat/i18n/keys.js";

const ZH_CN: MessageCatalog<ChatMessageKey> = {
  "chat.rollback.confirm.backfill": "快照丢失，将使用最新内容修复。\n\n丢失快照的文件：\n{files}\n\n{tail}",
  "chat.rollback.confirm.backfill.file": "· {path}",
  "chat.rollback.confirm.backfill.file.empty": "· （未知文件）",
  "chat.rollback.confirm.backfill.tail.rewind": "其余文件将正常回滚至锚点。",
  "chat.rollback.confirm.backfill.tail.undo_send": "其余文件将正常回滚至发送前状态。",
  "chat.rollback.confirm.degraded.rewind": "可仅删除此消息之后的对话，工作区文件将保持现状。",
  "chat.rollback.confirm.degraded.undo_send": "可仅删除此消息及之后的对话，工作区文件将保持现状。",
  "chat.rollback.confirm.primary.rewind": "将删除此消息之后的对话，并撤销相关文件修改。是否继续？",
  "chat.rollback.confirm.primary.undo_send": "将删除此消息及之后的对话，并撤销相关文件修改。是否继续？",
} satisfies Record<ChatMessageKey, string>;

const EN_US = {
  "chat.rollback.confirm.backfill": "Snapshots are missing and will be repaired with the latest content.\n\nFiles with missing snapshots:\n{files}\n\n{tail}",
  "chat.rollback.confirm.backfill.file": "· {path}",
  "chat.rollback.confirm.backfill.file.empty": "· (unknown file)",
  "chat.rollback.confirm.backfill.tail.rewind": "Other files will be rolled back to the anchor.",
  "chat.rollback.confirm.backfill.tail.undo_send": "Other files will be rolled back to their state before sending.",
  "chat.rollback.confirm.degraded.rewind": "This will only delete all messages after this one; workspace files will remain unchanged.",
  "chat.rollback.confirm.degraded.undo_send": "This will only delete this message and all later messages; workspace files will remain unchanged.",
  "chat.rollback.confirm.primary.rewind": "This will delete all messages after this one, and revert related file changes. Continue?",
  "chat.rollback.confirm.primary.undo_send": "This will delete this message and all later messages, and revert related file changes. Continue?",
} satisfies Partial<Record<ChatMessageKey, string>>;

/** 各宿主同步建 translator 的内嵌数据（不读盘；YAML 是唯一真源）。as const 保 locale 字面量键，下游 createTranslator 泛型推断不塌。 */
export const CHAT_CATALOGS = {
  "zh-CN": ZH_CN,
  "en-US": EN_US as MessageCatalog<ChatMessageKey>,
} as const;
