/**
 * 角色卡导入服务端口。
 *
 * @module domain/vfs/ports/character-card-import.port
 */

import type { MdTree } from "@/domain/character-card/model/character-card.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

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
    /**
   * confirmed 门闸 / Phase A 路径与体积校验 / 导入事务链失败全走返回值
   * `Result.err`（错误通道迁移六期）；测试钩子裸 Error 维持直抛。
   */
    import(
        scope: VfsScope,
        tree: MdTree,
        options: CharacterCardImportOptions
    ): Promise<Result<void, AppError>>;

    /**
   * 便捷：bytes → 解析 → import；解析失败不写库。
   * PNG/JSON 判别与 {@link CharacterCardToMdTree.parse} 同一套顺序。
   * confirmed / 体积闸门 / 解析失败与导入事务链失败全走返回值 `Result.err`。
   */
    importFromBytes(
        scope: VfsScope,
        bytes: Uint8Array,
        options: CharacterCardImportOptions
    ): Promise<Result<void, AppError>>;
}
