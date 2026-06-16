/**
 * 用户 VFS 统一 tool turn 特性开关（默认开启）。
 *
 * @module domain/feature-flags/user-vfs-unified-tool-turn
 */

/** 关闭时恢复直写 VFS IPC + vfs markDirty + 旧 transcript 行为。 */
export const DEFAULT_USER_VFS_UNIFIED_TOOL_TURN = true;

/** 读取是否启用统一 tool turn；未配置时使用默认值。 */
export function isUserVfsUnifiedToolTurnEnabled(
  configured?: boolean,
): boolean {
  return configured ?? DEFAULT_USER_VFS_UNIFIED_TOOL_TURN;
}
