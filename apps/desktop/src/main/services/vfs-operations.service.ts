/**
 * VFS mutations for desktop file manager.
 *
 * 基础动作（create / delete）的实现已下沉 core（`@novel-master/core/vfs` 的
 * `vfs-entry-ops`）；重命名就是 `moveVfsPath` 的导出别名。本模块保留既有
 * import 面，避免 handler 侧多一条 main→main 依赖变更。
 */
export { deleteVfsEntry } from "@novel-master/core/vfs";
export { moveVfsPath as renameVfsDirectory, moveVfsPath as renameVfsFile } from "@novel-master/core/vfs";
