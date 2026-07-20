/**
 * Desktop renderer 对 `@novel-master/core/vfs` 的具名薄再导出。
 * 禁止 `export *`；禁止 createVfsService 等工厂。
 *
 * 工作区面板作用域优先用 `@shared/ipc-types` 的 `WorkspacePanelScope` /
 * `VfsScopeRequest`；下列 `VfsScope` 供预览等过渡路径。
 */

export type { VfsScope } from "@novel-master/core/vfs";

export { formatVfsErrorForUser } from "@novel-master/core/vfs";
