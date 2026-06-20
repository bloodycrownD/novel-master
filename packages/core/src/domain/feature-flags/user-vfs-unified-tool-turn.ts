/**
 * 用户 VFS 统一 tool turn 特性开关（默认开启）。
 *
 * 产品配置走 PersistentPreferences + runtime 调用 refreshUserVfsUnifiedToolTurnSnapshot；
 * 环境变量 NM_USER_VFS_UNIFIED_TOOL_TURN=0 仅作运维紧急关闭（同步生效）。
 *
 * @module domain/feature-flags/user-vfs-unified-tool-turn
 */

/** 关闭时恢复直写 VFS IPC + vfs markDirty + 旧 transcript 行为。 */
export const DEFAULT_USER_VFS_UNIFIED_TOOL_TURN = true;

/** preferences 加载后由 runtime 写入的快照（undefined 表示尚未刷新）。 */
let preferenceSnapshot: boolean | undefined;

/** runtime 初始化时调用（测试中也可调用）。 */
export function refreshUserVfsUnifiedToolTurnSnapshot(enabled: boolean): void {
  preferenceSnapshot = enabled;
}

/** 测试辅助：清除快照以模拟冷启动。 */
export function resetUserVfsUnifiedToolTurnSnapshotForTests(): void {
  preferenceSnapshot = undefined;
}

/**
 * 读取是否启用统一 tool turn。
 * 优先级：显式 configured → env=0 → preferenceSnapshot → 默认值。
 */
export function isUserVfsUnifiedToolTurnEnabled(
  configured?: boolean,
): boolean {
  if (configured !== undefined) return configured;
  if (process.env.NM_USER_VFS_UNIFIED_TOOL_TURN === "0") return false;
  if (preferenceSnapshot !== undefined) return preferenceSnapshot;
  return DEFAULT_USER_VFS_UNIFIED_TOOL_TURN;
}
