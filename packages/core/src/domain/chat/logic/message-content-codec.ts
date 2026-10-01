/**
 * chat 侧存量压缩正文的解码器：`content_blob` + `content_encoding` → JSON 明文。
 *
 * **明文是 chat_message 的正形态**（2026-09-30 用户拍板的全库明文决策）：
 * 写侧直写 `content_json` 明文、压缩两列恒 NULL。本文件因此只为**迁移期
 * 的存量压缩行**服务——反向搬运任务把它们解压回明文后，连同本文件
 * （decodeMessageContent）在 V1' 一并退役。当前消费方四处：readRowContent、
 * usage-stats 双形态读、read-ref repair 全表扫、反向搬运任务本体。
 *
 * 压缩 / 字节收整（tightBytes、decodeCompressedBytes 等）复用 vfs
 * ContentStore 侧共享模块（zlib-codec），不另起实现。写侧自 A2
 * （blob-binary-normalization 迭代）起**三端一律二进制 `zlib` BLOB**——
 * RN op-sqlite 的 BLOB 绑参已真机验证可用，旧 `zlib-b64` 文本形态只
 * 保留在读路径三形态兼容与归一任务的谓词里（存量行由归一任务搬运）。
 *
 * 解压过程有产物体量上限（解压炸弹闸门），挡「几百 KB blob 膨胀到数百 MB」——
 * 源是库内不可信字节，且消费面已含「启动即全量遍历」。
 *
 * @module domain/chat/logic/message-content-codec
 */

import {
  decodeCompressedBytes,
  decompressZlibBounded,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { chatInvalidArgument } from "@/errors/chat-errors.js";

/**
 * 解压产物体量上限：64MB（纵深防御用的解压炸弹闸门）。
 *
 * @remarks 明显大于单条消息的合理体量（8KB 量级）；真正的内容合法性闸门在
 * 搬运侧（解压后还要过一遍 `parseMessageContent`）。无闸门时实测 614KB 的
 * blob 可膨胀到 600MB——而本函数的暴露面已从「按需读单行」扩大到「启动即
 * 全量遍历」，不能让一条坏行吃掉整进程内存。实现与「为何不能读 ISIZE」见
 * {@link decompressZlibBounded}。
 */
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

/**
 * 将压缩两列解出 content blocks JSON 明文（**纯函数，无进程内缓存**）。
 *
 * 失败（不支持的 encoding / 解压失败 / **解压产物体量超阈值** / 字节形态异常）
 * 抛类型化 {@link ChatError}（INVALID_ARGUMENT，文案含消息 id）——与明文
 * parse 失败同语义：消息是用户数据本体，fail-fast 不做 file_cache 式静默
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
    // 解压炸弹闸门：几百 KB 的 blob 膨胀到数百 MB 在 inflate 途中即被拒，
    // 走坏行隔离、不拖垮进程。`decodeCompressedBytes` 只出真 zlib 流
    // （zlib / zlib-b64 两形态归一后都是 zlib），闸门成立。
    return new TextDecoder().decode(
      decompressZlibBounded(compressed, MAX_DECOMPRESSED_BYTES)
    );
  } catch (error) {
    throw chatInvalidArgument(
      `消息正文解压失败（不静默丢行，请反馈此 id）: ${messageId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
