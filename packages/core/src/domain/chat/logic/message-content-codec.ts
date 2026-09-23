/**
 * chat 侧消息正文 blob 编解码薄封装：`content_json` 明文 ↔
 * `content_blob`/`content_encoding` 写库字段。
 *
 * 压缩 / base64 / 字节收整（tightBytes、decodeCompressedBytes 等）全部
 * 复用 vfs ContentStore 侧共享模块（zlib-codec / blob-bytes-codec），
 * 平台分支与存量兼容口径对齐 file-cache-blob-codec 先例，不另起实现。
 *
 * @module domain/chat/logic/message-content-codec
 */

import {
  bytesToBase64,
  isReactNativeRuntime,
  VFS_CONTENT_ENCODING_ZLIB_B64,
} from "@/domain/vfs/content-store/logic/blob-bytes-codec.js";
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
  /** `zlib`（Node/Desktop/CLI）或 `zlib-b64`（RN，规避 op-sqlite BLOB 绑参）。 */
  readonly encoding: string;
  /** 压缩字节（zlib）或 base64 文本（zlib-b64）。 */
  readonly blob: Uint8Array | string;
}

/**
 * 将 content blocks JSON 明文编码为压缩两列写库字段。
 *
 * 平台分支照 file-cache-blob-codec / SqliteVfsContentStore 先例：RN 走
 * zlib-b64（fflate 压缩 + 纯 JS base64，规避 BLOB 绑参缺口，+33% 膨胀
 * 计入 mobile 压缩比预期）；Node 走 zlib 二进制 Uint8Array。压缩级别
 * 沿用 fflate 默认 level 6（全仓先例一致）。
 *
 * @param json content blocks 的 JSON 明文（恒非空串——blocks JSON 不会是 ''）。
 * @param forceZlibB64 单测注入点：强制落 `zlib-b64`（RN 形态）或 `zlib`
 *   （Node 形态）；缺省按 {@link isReactNativeRuntime} 运行时探测。
 *   repository 调用点不传，仅测试直调。
 */
export function encodeMessageContent(
  json: string,
  forceZlibB64?: boolean
): EncodedMessageContent {
  const compressed = compressZlib(new TextEncoder().encode(json));

  if (forceZlibB64 ?? isReactNativeRuntime()) {
    // Hermes/RN：zlib 后再 base64，以 TEXT 写入 content_blob 列。
    const b64 = bytesToBase64(compressed);
    return { encoding: VFS_CONTENT_ENCODING_ZLIB_B64, blob: b64 };
  }

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
