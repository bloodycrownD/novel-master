/**
 * zlib 编解码与 blob 字节收整（三方共用：vfs content-store、session-kkv
 * file_cache、RN 平台存量口径；与 ZIP 的 deflate/inflate 模块边界分离）。
 *
 * 压缩/解压经 `zlib-accelerator` 的宿主注册加速器分派（Node 注册
 * `node:zlib` 提速；未注册恒走 fflate，现行为零变化）。
 *
 * @module domain/vfs/content-store/logic/zlib-codec
 */

import { unzlibSync, Unzlib, zlibSync } from "fflate";
import { tryZlibDeflate, tryZlibInflate } from "./zlib-accelerator.js";
import {
  base64ToBytes,
  VFS_CONTENT_ENCODING_ZLIB_B64,
} from "./blob-bytes-codec.js";

/**
 * ContentStore 落库 encoding：原始 zlib 字节（三端同形态：Node / Desktop / RN）。
 *
 * @remarks 写侧恒落本编码（二进制 BLOB，RN 与 Node 同一形态）；
 * `VFS_CONTENT_ENCODING_ZLIB_B64` 仅剩读侧存量兜底（见 blob-bytes-codec）；get 须同时支持二者。
 */
export const VFS_CONTENT_ENCODING_ZLIB = "zlib" as const;

/**
 * zlib 压缩明文 UTF-8 字节。
 *
 * @remarks ContentStore 与 file_cache blob 共用；禁止 ZIP 路径调用本封装。
 * 宿主注册了 zlib 加速器（Node `node:zlib`）时优先走加速器，未注册/加速器
 * 失败回落 fflate（行为与历史一致）。
 */
export function compressZlib(plainUtf8: Uint8Array): Uint8Array {
  return tryZlibDeflate(plainUtf8) ?? zlibSync(plainUtf8);
}

/**
 * zlib 解压为 UTF-8 字节。
 *
 * @remarks ContentStore 与 file_cache blob 共用；禁止 ZIP 路径调用本封装。
 * 宿主注册了 zlib 加速器（Node `node:zlib`）时优先走加速器，未注册/加速器
 * 失败回落 fflate（行为与历史一致）。
 */
export function decompressZlib(compressed: Uint8Array): Uint8Array {
  return tryZlibInflate(compressed) ?? unzlibSync(compressed);
}

/** 有上限解压时喂给流式 inflate 的输入切片字节数。 */
const BOUNDED_INFLATE_SLICE_BYTES = 4096;

/**
 * 有解压产物体量上限的 zlib 解压（解压炸弹闸门）。
 *
 * @remarks **为什么不用 zlib 的 ISIZE 尾字段判上限**（先按 RFC 1950 实现过、
 * 实测不可行）：ISIZE 在 `[len-4, len)`，但本仓唯一的 zlib 生产者 fflate 的
 * `zlibSync` **只追加 4 字节 adler32、根本不写 ISIZE**（实测产物末 4 字节恒
 * 等于 adler32，Node zlib 同样只有 4 字节 trailer）。照 ISIZE 判会把**每一行**
 * 存量压缩行都误判成炸弹——实测跑一遍全库即全体行解码失败。
 *
 * 也不能靠给 fflate 传小 `out` 缓冲兜：①那是「按上限预分配」（迁移期逐行走
 * 一次，64MB/次不可接受）；②越界时抛的是 fflate 内部通用错误
 * `offset is out of bounds`，语义不可依赖。
 *
 * 做法：把输入切片喂给流式 {@link Unzlib}，边产出边判两道闸——①累计产出超
 * 上限；②按已观测膨胀比投影「剩余输入的潜在产出」，超上限即提前收手（炸弹
 * 在头一片就收手，不必先分配完）。切片取 4KB 是为单片的理论最大膨胀封顶：
 * deflate stored block 的最坏比约 65535/5 ≈ 13107:1，故单片最坏 ~52MB。
 * 正常消息（一段即读完）零额外开销：单切片、单 chunk 直接返回。
 *
 * @param compressed zlib 压缩字节。
 * @param maxOutputBytes 解压产物体量上限（字节）；超限抛错，调用方据此走
 *   坏行隔离。
 */
export function decompressZlibBounded(
  compressed: Uint8Array,
  maxOutputBytes: number
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  let consumed = 0;
  const inflate = new Unzlib((chunk) => {
    produced += chunk.length;
    chunks.push(chunk);
    if (produced > maxOutputBytes) {
      throw new Error(
        `zlib 解压产物体量超上限：已产出 ${produced}B > 上限 ${maxOutputBytes}B`
      );
    }
    if (consumed > 0) {
      const projected =
        (produced / consumed) * (compressed.length - consumed);
      if (projected > maxOutputBytes) {
        throw new Error(
          `zlib 解压炸弹嫌疑：按已观测膨胀比投影产出 ${Math.round(projected)}B > 上限 ${maxOutputBytes}B（已产出 ${produced}B）`
        );
      }
    }
  });
  // 至少推一次（空输入也要走 fflate 的头校验并照其语义抛错）。
  for (let at = 0; ; at += BOUNDED_INFLATE_SLICE_BYTES) {
    const end = Math.min(at + BOUNDED_INFLATE_SLICE_BYTES, compressed.length);
    consumed = end;
    const isFinal = end >= compressed.length;
    inflate.push(compressed.subarray(at, end), isFinal);
    if (isFinal) {
      break;
    }
  }
  const only = chunks.length === 1 ? chunks[0] : undefined;
  if (only != null) {
    return only;
  }
  const out = new Uint8Array(produced);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * 确保 BLOB 绑定使用独立 ArrayBuffer（RN / better-sqlite3 约定）。
 *
 * @remarks vfs content-store put 与 session-kkv file_cache encode 落库前
 * 共用：源视图可能带 byteOffset，直接绑参会越界，拷贝成紧凑数组兜底。
 */
export function tightBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

/**
 * 将已知为二进制 BLOB 的列值收成 Uint8Array。
 *
 * @remarks string 不得经此函数；zlib-b64 / 存量 string 路径在
 * {@link decodeCompressedBytes} 的约定分支处理。`label` 为错误文案中的
 * 表.列 名（如 `vfs_content_blob.bytes`），由调用方传入。
 */
export function asUint8Array(value: unknown, label: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  // RN quick-sqlite / 部分绑定可能直接给出 ArrayBuffer。
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error(
    `${label} 期望 Uint8Array/ArrayBuffer，实际 ${Object.prototype.toString.call(
      value
    )}`
  );
}

/**
 * 将 zlib-b64 列值（或 UTF-8 形态的 base64 字节）还原为 base64 文本。
 *
 * @remarks `label` 为错误文案中的表.列 名（如 `vfs_content_blob.bytes`）。
 */
export function asBase64Text(value: unknown, label: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return new TextDecoder().decode(bytes);
  }
  throw new Error(
    `${label} 期望 base64 字符串或 UTF-8 字节，实际 ${Object.prototype.toString.call(
      value
    )}`
  );
}

/**
 * 按 encoding 将 blob 列值解成 zlib 压缩字节。
 *
 * 三形态兼容（vfs content-store 与 session-kkv file_cache 的 get 共用，
 * 含 RN 平台存量口径）：
 * - `zlib` + Uint8Array/ArrayBuffer：原样
 * - `zlib` + string：存量 RN 误存 base64，按 base64 解
 * - `zlib-b64`：取 base64 文本再解码
 *
 * @param label 错误文案中的表.列 名（如 `vfs_content_blob.bytes` /
 *   `session_file_cache_blob.bytes`），由调用方传入以区分两表。
 */
export function decodeCompressedBytes(
  encoding: string,
  bytes: unknown,
  label: string
): Uint8Array {
  if (encoding === VFS_CONTENT_ENCODING_ZLIB) {
    if (typeof bytes === "string") {
      // 存量：Mobile 曾写 encoding=zlib，但 quick-sqlite 读回为 base64 字符串。
      return base64ToBytes(bytes);
    }
    return asUint8Array(bytes, label);
  }

  if (encoding === VFS_CONTENT_ENCODING_ZLIB_B64) {
    const b64 = asBase64Text(bytes, label);
    return base64ToBytes(b64);
  }

  throw new Error(`不支持的 blob encoding: ${encoding}`);
}
