/**
 * 文件管理器的基础 VFS 变更（create / delete），经 {@link VfsService} 组合。
 *
 * 双端（desktop main / mobile）的同名操作此前各有一份逐字实现；平台差异只在
 * 上层的对话框与 session 包装，基础动作本身无平台依赖。
 * 重命名不在此列——它就是 `VfsMove.move` 的别名，两端在各自的 service 模块里
 * re-export，不再多一层转手 wrapper。
 *
 * @module domain/vfs/logic/vfs-entry-ops
 */

import type { VfsService } from "../ports/vfs-service.port.js";

export const VfsEntryOps = {
    /** 新建文件（默认空内容）。 */
    // nm-style: keep-public — 双端文件管理器的共享原语；每端各经自己的 service 模块转出给 UI，
    // 内联回单端会把刚收敛掉的双份实现重新拆开（本文件存在的唯一理由）。
    async createFile(vfs: VfsService, path: string, content = ""): Promise<void> {
        await vfs.write(path, content);
    },

    /**
   * 新建目录节点，先去掉尾斜杠。
   *
   * 不复用 `Path.stripTrailingSlash`：后者保留根 `/`，这里对 `/` 会得到空串——两端既有
   * 行为如此，改掉会让根级 mkdir 从「报错」变成「在根上操作」，保持原样。
   */
    // nm-style: keep-public — 同上：双端共享原语，经各端 service 模块转出给文件管理器。
    async createDirectory(vfs: VfsService, dirPath: string): Promise<void> {
        const normalized = dirPath.endsWith("/") ? dirPath.slice(0, -1) : dirPath;
        await vfs.mkdir(normalized);
    },

    /** 删除文件或整棵目录树（默认递归）。 */
    // nm-style: keep-public — 同上：desktop handler 与 mobile 工作区删除共用同一基础动作。
    async deleteEntry(vfs: VfsService, path: string, options?: { recursive?: boolean }): Promise<void> {
        await vfs.delete(path, { recursive: options?.recursive ?? true });
    },
} as const;
