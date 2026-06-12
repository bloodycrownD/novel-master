/**
 * 测试用：手工构造 GBK 文件名的最小 ZIP（无 EFS 标志）。
 */

import { deflateSync } from "fflate";
import iconv from "iconv-lite";

export interface GbkZipEntrySpec {
  /** 逻辑路径（将按 GBK 编码写入中央目录） */
  readonly logicalPath: string;
  readonly content: string;
  /** 压缩方式，默认 STORE */
  readonly method?: 0 | 8;
}

function writeUInt16LE(target: number[], value: number): void {
  target.push(value & 0xff, (value >> 8) & 0xff);
}

function writeUInt32LE(target: number[], value: number): void {
  target.push(
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  );
}

/**
 * 构造模拟 Windows 资源管理器风格的 GBK 文件名 ZIP（未置 UTF-8 EFS 位）。
 */
export function buildGbkFilenameZip(entries: readonly GbkZipEntrySpec[]): Uint8Array {
  const body: number[] = [];
  const central: number[] = [];
  const localOffsets: number[] = [];

  for (const entry of entries) {
    const rawName = iconv.encode(entry.logicalPath, "gbk");
    const contentBytes = new TextEncoder().encode(entry.content);
    const method = entry.method ?? 0;
    const payload =
      method === 8 ? deflateSync(contentBytes) : contentBytes;

    localOffsets.push(body.length);

    writeUInt32LE(body, 0x04034b50);
    writeUInt16LE(body, 20);
    writeUInt16LE(body, 0);
    writeUInt16LE(body, method);
    writeUInt16LE(body, 0);
    writeUInt16LE(body, 0);
    writeUInt32LE(body, 0);
    writeUInt32LE(body, payload.length);
    writeUInt32LE(body, contentBytes.length);
    writeUInt16LE(body, rawName.length);
    writeUInt16LE(body, 0);
    body.push(...rawName);
    body.push(...payload);

    writeUInt32LE(central, 0x02014b50);
    writeUInt16LE(central, 20);
    writeUInt16LE(central, 20);
    writeUInt16LE(central, 0);
    writeUInt16LE(central, method);
    writeUInt16LE(central, 0);
    writeUInt16LE(central, 0);
    writeUInt32LE(central, 0);
    writeUInt32LE(central, payload.length);
    writeUInt32LE(central, contentBytes.length);
    writeUInt16LE(central, rawName.length);
    writeUInt16LE(central, 0);
    writeUInt16LE(central, 0);
    writeUInt16LE(central, 0);
    writeUInt16LE(central, 0);
    writeUInt32LE(central, 0);
    writeUInt32LE(central, localOffsets[localOffsets.length - 1]!);
    central.push(...rawName);
  }

  const centralDirOffset = body.length;
  body.push(...central);
  const centralDirSize = central.length;

  writeUInt32LE(body, 0x06054b50);
  writeUInt16LE(body, 0);
  writeUInt16LE(body, 0);
  writeUInt16LE(body, entries.length);
  writeUInt16LE(body, entries.length);
  writeUInt32LE(body, centralDirSize);
  writeUInt32LE(body, centralDirOffset);
  writeUInt16LE(body, 0);

  return new Uint8Array(body);
}
