/**
 * chat 侧存量压缩正文的解码器：`content_blob` + `content_encoding` → JSON 明文。
 *
 * **明文是 chat_message 的正形态**（2026-09-30 用户拍板的全库明文决策）：
 * 写侧直写 `content_json` 明文、压缩两列恒 NULL。本文件因此只为**迁移期
 * 的存量压缩行**服务——反向搬运任务把它们解压回明文后，连同本文件
 * （含 decodeMessageContent 与仍留着的 encodeMessageContent）在 V1'
 * 一并退役。当前消费方四处：readRowContent、usage-stats 双形态读、
 * read-ref repair 全表扫、反向搬运任务本体。
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
 * **过渡期存量**：写路径已不再调用本函数（Step 1 起 chat_message 直写明文）。
 * 唯一残余消费方是正向压缩搬运任务 `message-content-compaction.ts`——它
 * 将在 Step 3 随该任务整文件删除，本函数届时一并删除，**不要给新写路径
 * 用**。
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
 * 将压缩两列解出 content blocks JSON 明文（**纯函数，无进程内缓存**）。
 *
 * 失败（不支持的 encoding / 解压失败 / 字节形态异常）抛类型化
 * {@link ChatError}（INVALID_ARGUMENT，文案含消息 id）——与明文 parse
 * 失败同语义：消息是用户数据本体，fail-fast 不做 file_cache 式静默
 * miss 自愈。
 *
 * 纯函数化的原因（2026-09-30）：原实现把解压产物按 messageId 记进
 * `infra/content-cache` 的消息正文池，随该池删除（明文化后压缩行只是待搬运
 * 的存量形态，不再值得维持「同 id 换正文必须失效」的不变式）而一并去掉了
 * 池回填。代价是存量压缩行的重复读每次都重新 inflate——短窗口可接受。
 *
 * @param encoding `content_encoding` 列值。
 * @param blob `content_blob` 列值（zlib 二进制 / zlib-b64 文本或 UTF-8 字节）。
 * @param messageId 消息 id：仅用于错误文案定位（不再作缓存键）。
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
  try {
    const compressed = decodeCompressedBytes(
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
