/**
 * ZIP 中央目录与 EOCD 解析（仅 STORE/DEFLATE，无加密、无 ZIP64）。
 *
 * @module domain/vfs/logic/vfs-zip-central-dir
 */

import { inflateSync } from "fflate";
import { vfsZipError, VfsZipError } from "@/errors/vfs-zip-errors.js";
import { decodeZipEntryName } from "./vfs-zip-filename-decode.js";
import {
  DEFAULT_VFS_ZIP_LIMITS,
  type VfsZipLimits,
} from "./vfs-zip-limits.js";

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

const ZIP_GPBF_ENCRYPTED = 0x0001;
const ZIP_SIZE_ZIP64_MARKER = 0xffffffff;

/** 中央目录解析后的单条条目（含解压后正文）。 */
export interface ZipCentralDirEntry {
  readonly entryName: string;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly data: Uint8Array;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minEocdSize = 22;
  const maxCommentLen = 0xffff;
  const searchStart = Math.max(0, bytes.length - (minEocdSize + maxCommentLen));
  for (let i = bytes.length - minEocdSize; i >= searchStart; i--) {
    if (readUInt32LE(bytes, i) === EOCD_SIG) {
      return i;
    }
  }
  throw vfsZipError("INVALID_ZIP", "ZIP end of central directory not found");
}

function assertSupportedCompressionMethod(
  method: number,
  entryLabel: string
): void {
  if (method !== ZIP_METHOD_STORE && method !== ZIP_METHOD_DEFLATE) {
    throw vfsZipError(
      "INVALID_ZIP",
      `unsupported compression method ${method} for ${entryLabel}`
    );
  }
}

function assertNotEncrypted(gpbf: number, entryLabel: string): void {
  if ((gpbf & ZIP_GPBF_ENCRYPTED) !== 0) {
    throw vfsZipError(
      "INVALID_ZIP",
      `encrypted ZIP entry not supported: ${entryLabel}`
    );
  }
}

function assertNoZip64Marker(value: number, field: string): void {
  if (value === ZIP_SIZE_ZIP64_MARKER) {
    throw vfsZipError("INVALID_ZIP", `ZIP64 ${field} not supported`);
  }
}

function decompressEntryData(
  compressed: Uint8Array,
  method: number,
  uncompressedSize: number,
  entryLabel: string,
  remainingBudget: number
): Uint8Array {
  if (method === ZIP_METHOD_STORE) {
    if (compressed.length !== uncompressedSize) {
      throw vfsZipError(
        "INVALID_ZIP",
        `STORE size mismatch for ${entryLabel}: expected ${uncompressedSize}, got ${compressed.length}`
      );
    }
    return compressed;
  }
  // 动手前的单条兜底：声明值本身已超剩余预算 ⇒ 不进 inflateSync。
  if (uncompressedSize > remainingBudget) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP entry ${entryLabel} exceeds remaining size budget (${uncompressedSize} > ${remainingBudget})`
    );
  }
  try {
    const inflated = inflateSync(compressed);
    if (inflated.length !== uncompressedSize) {
      throw vfsZipError(
        "INVALID_ZIP",
        `DEFLATE size mismatch for ${entryLabel}: expected ${uncompressedSize}, got ${inflated.length}`
      );
    }
    return inflated;
  } catch (error) {
    if (error instanceof VfsZipError) {
      throw error;
    }
    throw vfsZipError("INVALID_ZIP", `failed to inflate ${entryLabel}`);
  }
}

function readLocalEntryData(
  bytes: Uint8Array,
  entry: {
    localHeaderOffset: number;
    compressedSize: number;
    uncompressedSize: number;
    method: number;
    entryName: string;
  },
  remainingBudget: number
): Uint8Array {
  const { localHeaderOffset } = entry;
  if (readUInt32LE(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER_SIG) {
    throw vfsZipError(
      "INVALID_ZIP",
      `invalid local file header at offset ${localHeaderOffset}`
    );
  }
  const localMethod = readUInt16LE(bytes, localHeaderOffset + 8);
  if (localMethod !== entry.method) {
    throw vfsZipError(
      "INVALID_ZIP",
      `compression method mismatch for ${entry.entryName}`
    );
  }
  const fileNameLen = readUInt16LE(bytes, localHeaderOffset + 26);
  const extraLen = readUInt16LE(bytes, localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) {
    throw vfsZipError(
      "INVALID_ZIP",
      `truncated entry data for ${entry.entryName}`
    );
  }
  const compressed = bytes.subarray(dataStart, dataEnd);
  return decompressEntryData(
    compressed,
    entry.method,
    entry.uncompressedSize,
    entry.entryName,
    remainingBudget
  );
}

/**
 * 解析 ZIP 中央目录，返回条目名（已解码）与解压后正文。
 *
 * @remarks 体积/条数闸在**解压之前**就判（CS-09）：EOCD 的 `totalEntries`
 *          先判条数上限；循环内累加**声明** `uncompressedSize`，越限立即抛
 *          （在 `readLocalEntryData` 之前），解压后再累加**实际**长度做二次
 *          确认。攻击者可控的 `uncompressedSize` 让几百 KB 的 zip 能让
 *          `inflateSync` 分配 GB 级——只在解压之后判就来不及了。
 *
 * @throws {VfsZipError} `PAYLOAD_TOO_LARGE` 条数或解压后总体积越限
 * @throws {VfsZipError} `INVALID_ZIP` 当归档结构不受支持或无法读取
 */
export function parseZipCentralDirectory(
  zipBytes: Uint8Array,
  limits: VfsZipLimits = DEFAULT_VFS_ZIP_LIMITS
): ZipCentralDirEntry[] {
  if (zipBytes.length < 22) {
    throw vfsZipError("INVALID_ZIP", "ZIP archive too small");
  }

  const eocdOffset = findEndOfCentralDirectory(zipBytes);
  const totalEntries = readUInt16LE(zipBytes, eocdOffset + 10);
  const centralDirSize = readUInt32LE(zipBytes, eocdOffset + 12);
  const centralDirOffset = readUInt32LE(zipBytes, eocdOffset + 16);

  assertNoZip64Marker(centralDirSize, "central directory size");
  assertNoZip64Marker(centralDirOffset, "central directory offset");

  const centralDirEnd = centralDirOffset + centralDirSize;
  if (centralDirEnd > eocdOffset || centralDirOffset > zipBytes.length) {
    throw vfsZipError("INVALID_ZIP", "invalid central directory bounds");
  }

  // 条数闸：解压任何一条**之前**。
  if (totalEntries > limits.maxEntryCount) {
    throw vfsZipError(
      "PAYLOAD_TOO_LARGE",
      `ZIP entry count ${totalEntries} exceeds limit ${limits.maxEntryCount}`
    );
  }

  const entries: ZipCentralDirEntry[] = [];
  let declaredBytes = 0;
  let actualBytes = 0;
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > centralDirEnd) {
      throw vfsZipError("INVALID_ZIP", "truncated central directory entry");
    }
    if (readUInt32LE(zipBytes, offset) !== CENTRAL_DIR_HEADER_SIG) {
      throw vfsZipError("INVALID_ZIP", "invalid central directory file header");
    }

    const gpbf = readUInt16LE(zipBytes, offset + 8);
    const method = readUInt16LE(zipBytes, offset + 10);
    const compressedSize = readUInt32LE(zipBytes, offset + 20);
    const uncompressedSize = readUInt32LE(zipBytes, offset + 24);
    const fileNameLen = readUInt16LE(zipBytes, offset + 28);
    const extraLen = readUInt16LE(zipBytes, offset + 30);
    const commentLen = readUInt16LE(zipBytes, offset + 32);
    const localHeaderOffset = readUInt32LE(zipBytes, offset + 42);

    assertNoZip64Marker(compressedSize, "compressed size");
    assertNoZip64Marker(uncompressedSize, "uncompressed size");
    assertNoZip64Marker(localHeaderOffset, "local header offset");

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLen;
    const entryEnd = nameEnd + extraLen + commentLen;
    if (entryEnd > centralDirEnd) {
      throw vfsZipError(
        "INVALID_ZIP",
        "truncated central directory entry name"
      );
    }

    const rawNameBytes = zipBytes.subarray(nameStart, nameEnd);
    const entryName = decodeZipEntryName(rawNameBytes, gpbf);
    assertNotEncrypted(gpbf, entryName);
    assertSupportedCompressionMethod(method, entryName);

    // 体积闸在**动手之前**：先按声明值累加，越限直接抛，一条都不解压。
    declaredBytes += uncompressedSize;
    if (declaredBytes > limits.maxUncompressedBytes) {
      throw vfsZipError(
        "PAYLOAD_TOO_LARGE",
        `ZIP uncompressed size ${declaredBytes} exceeds limit ${limits.maxUncompressedBytes}`
      );
    }

    const data = readLocalEntryData(
      zipBytes,
      {
        localHeaderOffset,
        compressedSize,
        uncompressedSize,
        method,
        entryName,
      },
      limits.maxUncompressedBytes - declaredBytes
    );
    // 解压后二次确认（防「声明小、实际大」的谎报头把单条内存打穿）。
    actualBytes += data.length;
    if (actualBytes > limits.maxUncompressedBytes) {
      throw vfsZipError(
        "PAYLOAD_TOO_LARGE",
        `ZIP uncompressed size ${actualBytes} exceeds limit ${limits.maxUncompressedBytes}`
      );
    }

    entries.push({
      entryName,
      method,
      flags: gpbf,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      data,
    });

    offset = entryEnd;
  }

  return entries;
}
