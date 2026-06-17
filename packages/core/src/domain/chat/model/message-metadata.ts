/**
 * 会话消息 `raw.metadata` 约定类型（synthetic / 用户 VFS 等）。
 *
 * @module domain/chat/model/message-metadata
 */

/** synthetic 消息种类。 */
export type MessageMetadataKind =
  | "tool_turn_bridge"
  | "user_vfs_action"
  | "user_vfs_ack"
  | (string & {});

/** 写入 `ChatMessage.raw.metadata` 的键结构。 */
export interface MessageMetadata {
  /** 消息来源：`user` 表示用户侧 synthetic。 */
  readonly source?: "user";
  /** 行为主体：`user` 表示用户触发的 assistant synthetic。 */
  readonly actor?: "user";
  /** 是否为 synthetic 消息（非模型原生输出）。 */
  readonly synthetic?: boolean;
  /** synthetic 子类型。 */
  readonly kind?: MessageMetadataKind;
  /** 历史 U-A-U-A 中 assistant tool_use 是否已压缩 input（旧会话）。 */
  readonly toolInputCompressed?: boolean;
}

/** 从 `raw` 对象读取 metadata（无则 undefined）。 */
export function readMessageMetadata(
  raw: Record<string, unknown> | null | undefined,
): MessageMetadata | undefined {
  if (raw == null) {
    return undefined;
  }
  const meta = raw.metadata;
  if (meta == null || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }
  return meta as MessageMetadata;
}
