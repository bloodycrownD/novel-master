/**
 * 用户 VFS 统一 tool turn 特性开关（默认开启）。
 *
 * 产品配置走 PersistentPreferences + runtime 写入快照；
 * 环境变量 NM_USER_VFS_UNIFIED_TOOL_TURN=0 仅作运维紧急关闭（同步生效）。
 *
 * 快照是进程级可变状态，收在 {@link UserVfsUnifiedToolTurnFlag} 实例里，
 * 调用方只通过 {@link userVfsUnifiedToolTurnFlag} 读写。
 *
 * @module domain/feature-flags/user-vfs-unified-tool-turn
 */

/** 关闭时恢复直写 VFS IPC + vfs markDirty + 旧 transcript 行为。 */
/** nm-style: keep-public — 三端 runtime / core-shim 共享的默认值契约。 */
export const DEFAULT_USER_VFS_UNIFIED_TOOL_TURN = true;

/** preferences 快照与读取策略；`snapshot === undefined` 表示尚未刷新。 */
class UserVfsUnifiedToolTurnFlag {
  private snapshot: boolean | undefined;

  /** runtime 初始化后写入产品配置快照。 */
  refresh(enabled: boolean): void {
    this.snapshot = enabled;
  }

  /** 测试辅助：清除快照以模拟冷启动。 */
  /** nm-style: keep-public — 测试通过公开方法重置进程级快照。 */
  resetForTests(): void {
    this.snapshot = undefined;
  }

  /**
   * 读取是否启用统一 tool turn。
   * 优先级：显式 configured → env=0 → preferenceSnapshot → 默认值。
   */
  isEnabled(configured?: boolean): boolean {
    if (configured !== undefined) return configured;
    if (process.env.NM_USER_VFS_UNIFIED_TOOL_TURN === "0") return false;
    if (this.snapshot !== undefined) return this.snapshot;
    return DEFAULT_USER_VFS_UNIFIED_TOOL_TURN;
  }
}

/** 进程级唯一快照。 */
export const userVfsUnifiedToolTurnFlag = new UserVfsUnifiedToolTurnFlag();
