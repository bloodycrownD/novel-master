/**
 * ContentStore BLOB 字节 ↔ base64 文本编解码（规避 RN quick-sqlite BLOB 绑参）。
 *
 * @module domain/vfs/content-store/logic/blob-bytes-codec
 */

/** Hermes / RN 落库 encoding：zlib 后再 base64，以 TEXT 形态写入 bytes 列。 */
export const VFS_CONTENT_ENCODING_ZLIB_B64 = "zlib-b64" as const;

/**
 * 将字节序列编码为 base64 字符串（对齐 sksp-android：纯 JS btoa）。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * 将 base64 字符串解码为字节序列（对齐 sksp-android：纯 JS atob）。
 */
export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * 探测当前运行时是否为 React Native（不依赖 RN Platform）。
 *
 * @remarks 与 llm-sse-transport 一致：看 `navigator.product === "ReactNative"`。
 */
export function isReactNativeRuntime(): boolean {
  return (
    (globalThis as { navigator?: { product?: string } }).navigator?.product ===
    "ReactNative"
  );
}
