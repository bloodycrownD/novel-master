/**
 * VFS 端口失败载荷类型。
 *
 * service 层端口直抛 AppError（`VFS_*` key，三期 Step 6 删 legacy-vfs-error
 * mapper 后无第二形态），copy / move 编排层把 `isVfsError` 判中的端口异常
 * 原样放进 `Result.err`；本类型锁定这批 key 的并集。
 *
 * @module domain/vfs/logic/vfs-port-error
 */

import type { AppError } from "@/errors/app-error.js";

/** 端口异常的失败载荷（九个 VFS 域 key 的并集）。 */
export type VfsPortError = AppError<
  | "VFS_NOT_FOUND"
  | "VFS_REPLACE_NOT_FOUND"
  | "VFS_DIRECTORY_NOT_EMPTY"
  | "VFS_INVALID_PATH"
  | "VFS_INVALID_NAME"
  | "VFS_IS_DIRECTORY"
  | "VFS_ALREADY_EXISTS"
  | "VFS_NOT_A_DIRECTORY"
  | "VFS_PARENT_NOT_FOUND"
>;
