/**
 * 数据库维护（清理/导入/导出）进程级忙碌状态：独立小模块持有。
 *
 * 对齐 desktop 侧 db-maintenance-busy.ts：消息正文压缩搬运的后台循环
 * 需要读「用户是否正在清理/导入导出」以让路（spec 拍板：与备份互斥），
 * 而 UI 组件的 dbBusy 是本地 state，后台任务读不到——收敛到模块级。
 */

let maintenanceBusy = false;

/** 数据清理/导入/导出是否进行中（消息压缩后台循环的让路守卫）。 */
export function isMobileDbMaintenanceBusy(): boolean {
  return maintenanceBusy;
}

/** 仅限 db-maintenance / db-backup 服务入口与测试使用。 */
export function setMobileDbMaintenanceBusy(busy: boolean): void {
  maintenanceBusy = busy;
}
