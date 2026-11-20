/**
 * VFS mutations for desktop file manager.
 *
 * 基础动作（create / delete）的实现已下沉 core（`@novel-master/core/vfs` 的
 * `VfsEntryOps`）；重命名就是 `VfsMove.move`。本模块保留既有 import 面，
 * 避免 handler 侧多一条 main→main 依赖变更。
 */
export { VfsEntryOps, VfsMove } from "@novel-master/core/vfs";
