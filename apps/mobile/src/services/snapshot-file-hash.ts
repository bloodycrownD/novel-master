/**
 * 快照文件分块 SHA-256（避免整包读入 JS 内存）。
 *
 * @module services/snapshot-file-hash
 */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {Buffer} from 'buffer';
import ReactNativeBlobUtil from 'react-native-blob-util';

const CHUNK_SIZE = 512 * 1024;

/** 内存字节 SHA-256 十六进制 */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** 分块读取文件并计算 SHA-256 十六进制 */
export async function hashSnapshotFile(path: string): Promise<string> {
  const hasher = sha256.create();
  const stream = await ReactNativeBlobUtil.fs.readStream(
    path,
    'base64',
    CHUNK_SIZE,
  );

  await new Promise<void>((resolve, reject) => {
    stream.open();
    stream.onData((chunk: string | number[]) => {
      const base64 =
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('base64');
      hasher.update(Buffer.from(base64, 'base64'));
    });
    stream.onError((error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    stream.onEnd(() => resolve());
  });

  return bytesToHex(hasher.digest());
}
