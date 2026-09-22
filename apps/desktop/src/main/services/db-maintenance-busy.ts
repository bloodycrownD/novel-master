/**
 * 数据清理（VACUUM）进程级忙碌状态：独立小模块持有。
 *
 * 抽成零依赖模块的原因：db-maintenance.service 需要读 cloud-sync 的
 * syncBusy，而 cloud-sync 的 getLocalStatus 又要回报 maintenanceBusy，
 * 两侧互相引用会形成循环 import——把状态收敛到这里，依赖即成单向
 * （db-maintenance.service 与 cloud-sync.service 都只依赖本模块）。
 */

let maintenanceBusy = false;

/** 数据清理是否进行中（供 getLocalStatus 回报与 UI 禁用判断）。 */
export function isDesktopDbMaintenanceBusy(): boolean {
  return maintenanceBusy;
}

/** 仅限 db-maintenance.service 内部与测试使用。 */
export function setDesktopDbMaintenanceBusy(busy: boolean): void {
  maintenanceBusy = busy;
}

/** 测试用：复位忙碌状态。 */
export function resetDesktopDbMaintenanceBusyForTest(): void {
  maintenanceBusy = false;
}
