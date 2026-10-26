/**
 * base64 文本 → 字节序列。
 *
 * @module common/base64
 */

/** 解码 base64 文本（纯 JS atob，Node / RN 通用）。 */
export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** 编码字节序列为 base64 文本；按 0x8000 切段，避免超大 spread 撑爆调用栈。 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return globalThis.btoa(binary);
}
