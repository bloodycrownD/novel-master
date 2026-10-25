/**
 * base64 文本 → 字节序列。
 *
 * @module common/base64
 */

/** 解码 base64 文本（纯 JS atob，Node / RN 通用）。 */
export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
