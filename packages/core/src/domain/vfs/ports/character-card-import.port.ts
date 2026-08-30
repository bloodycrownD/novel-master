/**
 * 角色卡导入服务端口。
 *
 * @module domain/vfs/ports/character-card-import.port
 */

import type { MdTree } from "@/domain/character-card/model/character-card.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** 角色卡导入选项（对齐 ZIP：须 confirmed）。 */
export type CharacterCardImportOptions = {
  readonly confirmed: boolean;
  /** 目标目录；缺省 `/`。 */
  readonly directoryPath?: string;
};

/**
 * 确认后将 md 树整子树替换写入 VFS。
 */
export interface CharacterCardImportService {
  import(
    scope: VfsScope,
    tree: MdTree,
    options: CharacterCardImportOptions
  ): Promise<void>;

  /**
   * 便捷：bytes → 解析 → import；解析失败不写库。
   * PNG/JSON 判别与 {@link parseCharacterCardToMdTree} 同一套顺序。
   */
  importFromBytes(
    scope: VfsScope,
    bytes: Uint8Array,
    options: CharacterCardImportOptions
  ): Promise<void>;
}
