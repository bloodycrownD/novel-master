/**
 * 角色卡 md 树的体积/条目闸门（Phase A 路径校验之后、写库事务之前）。
 *
 * 与 ZIP 导入的 `VFS_ZIP_MAX_UNCOMPRESSED_BYTES` / `VFS_ZIP_MAX_ENTRY_COUNT`
 * 对齐：超限的卡片在解析成 md 树后仍可能在落库与后续读取链上产生多份全尺寸
 * 拷贝，这里在事务前整体拒绝，保证零写库。
 *
 * @module domain/character-card/logic/validate-md-tree-limits
 */

import { characterCardError } from "@/errors/character-card-errors.js";
import {
  CHARACTER_CARD_MAX_FILE_COUNT,
  CHARACTER_CARD_MAX_SINGLE_FILE_BYTES,
  CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES,
  utf8ByteLength,
} from "./character-card-limits.js";

/**
 * 校验 md 树的条目数 / 单文件 / 总量三道闸，任一超限抛 `TOO_LARGE`。
 *
 * @param files 相对路径 → content 的映射（{@link MdTree} 或 Phase A 拼好的
 *   逻辑路径产物均可，本函数只关心条目数与 content 大小）
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError} `TOO_LARGE`
 */
export function validateMdTreeLimits(
  files: ReadonlyMap<string, string>
): void {
  if (files.size > CHARACTER_CARD_MAX_FILE_COUNT) {
    throw characterCardError(
      "TOO_LARGE",
      `角色卡过大：共 ${files.size} 个文件，超过条目数上限 ${CHARACTER_CARD_MAX_FILE_COUNT}，已拒绝导入`
    );
  }

  let totalBytes = 0;
  for (const [path, content] of files) {
    const sizeBytes = utf8ByteLength(content);
    if (sizeBytes > CHARACTER_CARD_MAX_SINGLE_FILE_BYTES) {
      throw characterCardError(
        "TOO_LARGE",
        `角色卡过大：文件 "${path}" 内容 ${sizeBytes} 字节，超过单文件上限 ${CHARACTER_CARD_MAX_SINGLE_FILE_BYTES} 字节，已拒绝导入`
      );
    }
    totalBytes += sizeBytes;
    // 超限即抛，避免对后续条目做无谓的编码累计
    if (totalBytes > CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES) {
      throw characterCardError(
        "TOO_LARGE",
        `角色卡过大：全部文件内容合计 ${totalBytes} 字节，超过总量上限 ${CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES} 字节，已拒绝导入`
      );
    }
  }
}
