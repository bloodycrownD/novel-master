/**
 * chat 侧消息正文 blob 编解码薄封装：`content_json` 明文 ↔
 * `content_blob`/`content_encoding` 写库字段。
 *
 * 压缩 / 字节收整（tightBytes、decodeCompressedBytes 等）复用 vfs
 * ContentStore 侧共享模块（zlib-codec），不另起实现。写侧自 A2
 * （blob-binary-normalization 迭代）起**三端一律二进制 `zlib` BLOB**——
 * RN op-sqlite 的 BLOB 绑参已真机验证可用，旧 `zlib-b64` 文本形态只
 * 保留在读路径三形态兼容与归一任务的谓词里（存量行由归一任务搬运）。
 *
 * @module domain/chat/logic/message-content-codec
 */

import {
  compressZlib,
  decodeCompressedBytes,
  decompressZlib,
  tightBytes,
  VFS_CONTENT_ENCODING_ZLIB,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { chatInvalidArgument } from "@/errors/chat-errors.js";

/** {@link encodeMessageContent} 产物：写 chat_message 压缩两列所需字段。 */
export interface EncodedMessageContent {
  /** 恒 `zlib`（三端统一二进制；`zlib-b64` 仅是读侧兼容的存量形态）。 */
  readonly encoding: string;
  /** 压缩字节。 */
  readonly blob: Uint8Array;
}

/**
 * 将 content blocks JSON 明文编码为压缩两列写库字段。
 *
 * 无平台分支：RN 与 Node 同一形态（二进制 Uint8Array + `zlib`）。压缩级别
 * 沿用 fflate 默认 level 6（全仓先例一致）。
 *
 * @param json content blocks 的 JSON 明文（恒非空串——blocks JSON 不会是 ''）。
 */
export function encodeMessageContent(
  json: string
): EncodedMessageContent {
  const compressed = compressZlib(new TextEncoder().encode(json));
  return {
    encoding: VFS_CONTENT_ENCODING_ZLIB,
    blob: tightBytes(compressed),
  };
}

/**
 * 将压缩两列解出 content blocks JSON 明文。
 *
 * 失败（不支持的 encoding / 解压失败 / 字节形态异常）抛类型化
 * {@link ChatError}（INVALID_ARGUMENT，文案含消息 id）——与明文 parse
 * 失败同语义：消息是用户数据本体，fail-fast 不做 file_cache 式静默
 * miss 自愈。
 *
 * @param encoding `content_encoding` 列值。
 * @param blob `content_blob` 列值（zlib 二进制 / zlib-b64 文本或 UTF-8 字节）。
 * @param messageId 错误文案中的消息 id（T-C4：损坏 blob 不静默丢行）。
 */
export function decodeMessageContent(
  encoding: unknown,
  blob: unknown,
  messageId: string
): string {
  const encodingText =
    typeof encoding === "string"
      ? encoding
      : String(encoding ?? "(null)");
  let compressed: Uint8Array;
  try {
    compressed = decodeCompressedBytes(
      encodingText,
      blob,
      `chat_message.content_blob`
    );
    return new TextDecoder().decode(decompressZlib(compressed));
  } catch (error) {
    throw chatInvalidArgument(
      `消息正文解压失败（不静默丢行，请反馈此 id）: ${messageId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
