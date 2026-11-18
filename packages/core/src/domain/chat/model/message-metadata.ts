/**
 * 会话消息 `raw.metadata` 约定类型（synthetic / 用户 VFS 等）。
 *
 * @module domain/chat/model/message-metadata
 */

/**
 * 已知 synthetic 消息种类。
 *
 * 新增字面量必须同时在 {@link VFS_SEMANTIC_BY_KIND} 登记——本类型是
 * `satisfies Record<KnownMessageMetadataKind, boolean>` 的键全集，漏登记会编译失败。
 */
type KnownMessageMetadataKind = "tool_turn_bridge" | "user_vfs_action" | "user_vfs_ack";

/** synthetic 消息种类（含旧会话 / 未来版本写入的未知 kind）。 */
type MessageMetadataKind = KnownMessageMetadataKind | (string & {});

/** 已知 kind 的 VFS 语义标记：true = 不得与 plain chat 文本 merge。 */
const VFS_SEMANTIC_BY_KIND = { tool_turn_bridge: true, user_vfs_action: true, user_vfs_ack: true } as const satisfies Record<KnownMessageMetadataKind, boolean>;

/** VFS 语义段的消息 kind 集合（不得与 plain chat 文本 merge）。 */
export const VFS_SEMANTIC_KINDS: ReadonlySet<string> = new Set(Object.keys(VFS_SEMANTIC_BY_KIND).filter((kind) => VFS_SEMANTIC_BY_KIND[kind as KnownMessageMetadataKind]));

/** 该 metadata kind 是否属于 VFS 语义段。 */
export function isVfsSemanticKind(kind: string): boolean {
  return VFS_SEMANTIC_KINDS.has(kind);
}

/** 写入 `ChatMessageData.raw.metadata` 的键结构。 */
interface MessageMetadata {
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
export function readMessageMetadata(raw: Record<string, unknown> | null | undefined): MessageMetadata | undefined {
  if (raw == null) {
    return undefined;
  }
  const meta = raw.metadata;
  if (meta == null || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }
  return meta as MessageMetadata;
}
