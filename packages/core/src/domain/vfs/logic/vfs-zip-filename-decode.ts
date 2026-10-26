/**
 * ZIP 中央目录条目文件名字节解码（EFS UTF-8 / GBK / CP437）。
 *
 * @module domain/vfs/logic/vfs-zip-filename-decode
 */

import iconv from "iconv-lite";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** GPBF bit 11：文件名与注释使用 UTF-8（EFS）。 */
export const ZIP_GPBF_UTF8_EFS = 0x0800;

/** 条目名解码失败。 */
type ZipEntryNameError = AppError<"VFS_ZIP_INVALID_UTF8">;

/**
 * 将 ZIP 条目文件名字节解码为逻辑路径字符串。
 *
 * 解码顺序：EFS UTF-8 → GBK（含 ≥0x80 字节）→ CP437（纯 ASCII）。
 * 解码后统一将反斜杠替换为正斜杠。
 */
export function decodeZipEntryName(rawBytes: Uint8Array, gpbf: number): Result<string, ZipEntryNameError> {
  let name: string;
  if ((gpbf & ZIP_GPBF_UTF8_EFS) !== 0) {
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
    } catch {
      return Result.err(new AppError("VFS_ZIP_INVALID_UTF8", "ZIP entry name is not valid UTF-8", { byteLength: rawBytes.length }));
    }
  } else if (rawBytes.some((byte) => byte >= 0x80)) {
    name = iconv.decode(Buffer.from(rawBytes), "gbk");
  } else {
    name = iconv.decode(Buffer.from(rawBytes), "cp437");
  }
  return Result.ok(name.replace(/\\/g, "/"));
}
