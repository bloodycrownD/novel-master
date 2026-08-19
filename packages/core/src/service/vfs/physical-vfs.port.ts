/**
 * 只读物理树服务 port：把 global / project / session 与 meta 两域的
 * vfs_entry 拼接为统一物理视图（`/template`、`/meta`、`/projects/{pid}/...`）。
 *
 * 仅供全局文件浏览器只读访问；**类型层面即不存在任何写方法**
 * （write/mkdir/delete/rename 等一律不进本接口）。
 *
 * @module service/vfs/physical-vfs.port
 */

import type {
  VfsListEntry,
  VfsReadResult,
} from "@/domain/vfs/ports/vfs-service.port.js";

/** 只读物理树服务（无 scope，跨域拼接视图）。 */
export interface PhysicalVfsService {
  /**
   * 列物理目录的直接子项（非递归；懒加载：展开哪层查哪层）。
   *
   * @remarks
   * `/projects`、`/projects/{pid}` 及其 `template/`、`meta/`、`sessions/`、
   * `sessions/{sid}/` 等虚拟目录无表行，从 `chat_project` / `chat_session`
   * 枚举合成；空项目与空会话同样显示目录行。
   *
   * @throws {import("@/errors/vfs-errors.js").VfsError} `NOT_FOUND` 当路径不落在任何域前缀下，或项目/会话不存在
   */
  list(physicalPath: string): Promise<VfsListEntry[]>;

  /**
   * 读物理路径对应的文件内容。
   *
   * @remarks
   * 前缀解析顺序敏感：`/projects/{pid}/sessions/{sid}/` → session；
   * `/projects/{pid}/meta/` → project-meta；`/projects/{pid}/template/` →
   * project；`/meta/` → global-meta；`/template/` → global；其余 → 无此文件。
   * 解析后走既有单 scope `ScopedVfsService.read`。
   *
   * @throws {import("@/errors/vfs-errors.js").VfsError} `NOT_FOUND` 当路径不落在任何域前缀下或文件不存在
   */
  read(physicalPath: string): Promise<VfsReadResult>;
}
