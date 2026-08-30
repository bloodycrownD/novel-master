/**
 * RN 文件 URI / 字节转换工具的单一实现（services/C-3 收编）。
 *
 * 之前 db-backup / vfs-zip / vfs-character-card / yaml-shared 各持有一份
 * 逐字相同（或同族）的副本，改一处漏三处；现在统一从这里导入。
 */
import ReactNativeBlobUtil from 'react-native-blob-util';

/** blob-util on Android mishandles `file://` + encoded paths; use absolute fs path. */
export function localUriToFsPath(localUri: string): string {
  const withoutScheme = localUri.startsWith('file://')
    ? localUri.slice('file://'.length)
    : localUri;
  return decodeURIComponent(withoutScheme);
}

export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** 按 0x8000 切段再 fromCharCode，避免超大 spread 撑爆调用栈 / Hermes 堆。 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return globalThis.btoa(binary);
}

/** 字节块转 ascii 字符串（`writeStream(..., 'ascii')` 需要 string）。 */
export function bytesToAsciiString(bytes: Uint8Array): string {
  const charChunk = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += charChunk) {
    const slice = bytes.subarray(i, Math.min(i + charChunk, bytes.length));
    out += String.fromCharCode(...slice);
  }
  return out;
}

/**
 * 取 `react-native-blob-util` 的 fs 模块（services/A-1 收编）。
 *
 * WHY: RN native modules 在测试环境或不同 bundler 下可能以 CJS
 * 或 ESM 包裹形态出现，这里同时兼容两种形状，省得每个调用方都写一遍。
 */
export function blobFs(): typeof ReactNativeBlobUtil.fs {
  const anyMod = ReactNativeBlobUtil as unknown as {
    fs?: typeof ReactNativeBlobUtil.fs;
    default?: {fs?: typeof ReactNativeBlobUtil.fs};
  };
  const fs = anyMod.fs ?? anyMod.default?.fs;
  if (fs == null) {
    throw new Error('react-native-blob-util.fs unavailable');
  }
  return fs;
}
