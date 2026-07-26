/**
 * 明文内容指纹（UTF-8 → SHA-256 hex）。
 *
 * @module domain/vfs/content-store/logic/hash-content
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * 对 UTF-8 明文计算 SHA-256，返回小写 hex。
 *
 * @remarks noble v2 的 sha256 从 `sha2.js` 导出（与 mobile 对齐）；禁止以 node:crypto 作唯一实现。
 */
export function hashContent(plain: string): string {
  const utf8 = new TextEncoder().encode(plain);
  return bytesToHex(sha256(utf8));
}
