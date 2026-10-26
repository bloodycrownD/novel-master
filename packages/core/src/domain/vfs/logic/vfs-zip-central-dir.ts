/**
 * ZIP 中央目录与 EOCD 解析（仅 STORE/DEFLATE，无加密、无 ZIP64）。
 *
 * @module domain/vfs/logic/vfs-zip-central-dir
 */

import { inflateSync } from "fflate";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { decodeZipEntryName } from "./vfs-zip-filename-decode.js";
import { DEFAULT_VFS_ZIP_LIMITS, type VfsZipLimits } from "./vfs-zip-limits.js";

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

const ZIP_GPBF_ENCRYPTED = 0x0001;
const ZIP_SIZE_ZIP64_MARKER = 0xffffffff;

/** 中央目录解析的失败载荷。 */
type ZipCentralDirError = AppError<"VFS_ZIP_INVALID_ARCHIVE" | "VFS_ZIP_INVALID_UTF8" | "VFS_ZIP_PAYLOAD_TOO_LARGE">;

/** 中央目录解析后的单条条目（含解压后正文）。 */
interface ZipCentralDirEntry {
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
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function assertNoZip64Marker(value: number, field: string): ZipCentralDirError | null {
  if (value === ZIP_SIZE_ZIP64_MARKER) {
    return new AppError("VFS_ZIP_INVALID_ARCHIVE", `ZIP64 ${field} not supported`);
  }
  return null;
}

/**
 * 解压单条正文。
 *
 * ⚠️ 这里**没有**「本条声明值 > 剩余预算」的兜底闸（CR-F05 已删）：调用方
 * `parseZipCentralDirectory` 的总量闸用**已含本条**的 `declaredBytes` 判，而那个
 * 实参是「上限减已含本条的累计值」⇒ 本条会被算两遍，等价的误杀条件是
 * `前缀累计 + 2 × 本条 > 上限`。实测 20 MiB 单条 DEFLATE、10 × 3 MiB DEFLATE
 * （总额 30 MiB < 32 MiB 上限）全被误判 `PAYLOAD_TOO_LARGE`，同内容 STORE 却
 * 通过（STORE 分支提前 return）——同一份内容结论随压缩方式变化。总量闸已在本条
 * **动手之前**判过声明值，这里的分支恒不触发，只是重复犯错。
 */
// nm-style: keep-local — 本地文件头校验、正文切片与 STORE/DEFLATE 解压是同一段
// 条目读取管线（共享 compressed/uncompressed 尺寸与 method），内联会把它埋进中央目录循环。
function readLocalEntryData(bytes: Uint8Array, entry: { localHeaderOffset: number; compressedSize: number; uncompressedSize: number; method: number; entryName: string }): Result<Uint8Array, ZipCentralDirError> {
  const { localHeaderOffset } = entry;
  if (readUInt32LE(bytes, localHeaderOffset) !== LOCAL_FILE_HEADER_SIG) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `invalid local file header at offset ${localHeaderOffset}`));
  }
  const localMethod = readUInt16LE(bytes, localHeaderOffset + 8);
  if (localMethod !== entry.method) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `compression method mismatch for ${entry.entryName}`));
  }
  const fileNameLen = readUInt16LE(bytes, localHeaderOffset + 26);
  const extraLen = readUInt16LE(bytes, localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `truncated entry data for ${entry.entryName}`));
  }
  const compressed = bytes.subarray(dataStart, dataEnd);

  // ⚠️ 这里**没有**「本条声明值 > 剩余预算」的兜底闸（CR-F05 已删）：调用方
  // `parseZipCentralDirectory` 的总量闸用**已含本条**的 `declaredBytes` 判，而那个
  // 实参是「上限减已含本条的累计值」⇒ 本条会被算两遍，等价的误杀条件是
  // `前缀累计 + 2 × 本条 > 上限`。实测 20 MiB 单条 DEFLATE、10 × 3 MiB DEFLATE
  // （总额 30 MiB < 32 MiB 上限）全被误判 `PAYLOAD_TOO_LARGE`，同内容 STORE 却
  // 通过（STORE 分支提前 return）——同一份内容结论随压缩方式变化。总量闸已在本条
  // **动手之前**判过声明值，这里的分支恒不触发，只是重复犯错。
  if (entry.method === ZIP_METHOD_STORE) {
    if (compressed.length !== entry.uncompressedSize) {
      return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `STORE size mismatch for ${entry.entryName}: expected ${entry.uncompressedSize}, got ${compressed.length}`));
    }
    return Result.ok(compressed);
  }
  try {
    const inflated = inflateSync(compressed);
    if (inflated.length !== entry.uncompressedSize) {
      return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `DEFLATE size mismatch for ${entry.entryName}: expected ${entry.uncompressedSize}, got ${inflated.length}`));
    }
    return Result.ok(inflated);
  } catch {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `failed to inflate ${entry.entryName}`));
  }
}

/**
 * 解析 ZIP 中央目录，返回条目名（已解码）与解压后正文。
 *
 * @remarks 体积/条数闸在**解压之前**就判（CS-09）：EOCD 的 `totalEntries`
 *          先判条数上限；循环内累加**声明** `uncompressedSize`，越限立即返回
 *          （在 `readLocalEntryData` 之前），解压后再累加**实际**长度做二次
 *          确认。攻击者可控的 `uncompressedSize` 让几百 KB 的 zip 能让
 *          `inflateSync` 分配 GB 级——只在解压之后判就来不及了。
 *
 * ⚠️ 这里只有**一处**体积闸。曾经还有一道「本条声明值 vs 剩余预算」的单条兜底，
 *          它被算两遍（`remainingBudget` 传的是已含本条的余额）⇒ 合法包被误杀，
 *          已随 CR-F05 删除；新增单条闸前先确认它不是同款重复计数。
 */
export function parseZipCentralDirectory(zipBytes: Uint8Array, limits: VfsZipLimits = DEFAULT_VFS_ZIP_LIMITS): Result<ZipCentralDirEntry[], ZipCentralDirError> {
  if (zipBytes.length < 22) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", "ZIP archive too small"));
  }

  // EOCD 从尾部向前扫（注释最长 0xffff），找不到即归档不可读。
  const minEocdSize = 22;
  const searchStart = Math.max(0, zipBytes.length - (minEocdSize + 0xffff));
  let eocdOffset = -1;
  for (let i = zipBytes.length - minEocdSize; i >= searchStart; i--) {
    if (readUInt32LE(zipBytes, i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", "ZIP end of central directory not found"));
  }
  const totalEntries = readUInt16LE(zipBytes, eocdOffset + 10);
  const centralDirSize = readUInt32LE(zipBytes, eocdOffset + 12);
  const centralDirOffset = readUInt32LE(zipBytes, eocdOffset + 16);

  const centralDirSizeError = assertNoZip64Marker(centralDirSize, "central directory size");
  if (centralDirSizeError != null) return Result.err(centralDirSizeError);
  const centralDirOffsetError = assertNoZip64Marker(centralDirOffset, "central directory offset");
  if (centralDirOffsetError != null) return Result.err(centralDirOffsetError);

  const centralDirEnd = centralDirOffset + centralDirSize;
  if (centralDirEnd > eocdOffset || centralDirOffset > zipBytes.length) {
    return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", "invalid central directory bounds"));
  }

  // 条数闸：解压任何一条**之前**。
  if (totalEntries > limits.maxEntryCount) {
    return Result.err(new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP entry count ${totalEntries} exceeds limit ${limits.maxEntryCount}`));
  }

  const entries: ZipCentralDirEntry[] = [];
  let declaredBytes = 0;
  let actualBytes = 0;
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > centralDirEnd) {
      return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", "truncated central directory entry"));
    }
    if (readUInt32LE(zipBytes, offset) !== CENTRAL_DIR_HEADER_SIG) {
      return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", "invalid central directory file header"));
    }

    const gpbf = readUInt16LE(zipBytes, offset + 8);
    const method = readUInt16LE(zipBytes, offset + 10);
    const compressedSize = readUInt32LE(zipBytes, offset + 20);
    const uncompressedSize = readUInt32LE(zipBytes, offset + 24);
    const fileNameLen = readUInt16LE(zipBytes, offset + 28);
    const extraLen = readUInt16LE(zipBytes, offset + 30);
    const commentLen = readUInt16LE(zipBytes, offset + 32);
    const localHeaderOffset = readUInt32LE(zipBytes, offset + 42);

    const compressedSizeError = assertNoZip64Marker(compressedSize, "compressed size");
    if (compressedSizeError != null) return Result.err(compressedSizeError);
    const uncompressedSizeError = assertNoZip64Marker(uncompressedSize, "uncompressed size");
    if (uncompressedSizeError != null) return Result.err(uncompressedSizeError);
    const localHeaderOffsetError = assertNoZip64Marker(localHeaderOffset, "local header offset");
    if (localHeaderOffsetError != null) return Result.err(localHeaderOffsetError);

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLen;
    const entryEnd = nameEnd + extraLen + commentLen;
    if (entryEnd > centralDirEnd) {
      return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", "truncated central directory entry name"));
    }

    const rawNameBytes = zipBytes.subarray(nameStart, nameEnd);
    const decodedName = decodeZipEntryName(rawNameBytes, gpbf);
    if (!decodedName.ok) return Result.err(decodedName.error);
    const entryName = decodedName.value;
    if ((gpbf & ZIP_GPBF_ENCRYPTED) !== 0) {
      return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `encrypted ZIP entry not supported: ${entryName}`));
    }
    if (method !== ZIP_METHOD_STORE && method !== ZIP_METHOD_DEFLATE) {
      return Result.err(new AppError("VFS_ZIP_INVALID_ARCHIVE", `unsupported compression method ${method} for ${entryName}`));
    }

    // 体积闸在**动手之前**：先按声明值累加，越限直接返回，一条都不解压。
    declaredBytes += uncompressedSize;
    if (declaredBytes > limits.maxUncompressedBytes) {
      return Result.err(new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP uncompressed size ${declaredBytes} exceeds limit ${limits.maxUncompressedBytes}`));
    }

    const data = readLocalEntryData(zipBytes, { localHeaderOffset, compressedSize, uncompressedSize, method, entryName });
    if (!data.ok) return Result.err(data.error);
    // 解压后二次确认（防「声明小、实际大」的谎报头把单条内存打穿）。
    actualBytes += data.value.length;
    if (actualBytes > limits.maxUncompressedBytes) {
      return Result.err(new AppError("VFS_ZIP_PAYLOAD_TOO_LARGE", `ZIP uncompressed size ${actualBytes} exceeds limit ${limits.maxUncompressedBytes}`));
    }

    entries.push({ entryName, method, flags: gpbf, compressedSize, uncompressedSize, localHeaderOffset, data: data.value });
    offset = entryEnd;
  }

  return Result.ok(entries);
}
