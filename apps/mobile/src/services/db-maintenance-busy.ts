/**
 * 数据库维护（清理/导入/导出/云同步）进程级忙碌状态：独立小模块持有。
 *
 * 对齐 desktop 侧 db-maintenance-busy.ts：消息正文压缩搬运与 blob 归一的
 * 后台循环需要读「用户是否正在清理/导入导出/云同步」以让路（spec 拍板：
 * 与备份互斥），而 UI 组件的 dbBusy 是本地 state，后台任务读不到——收敛
 * 到模块级。
 *
 * busy 为计数/令牌配对：底层 acquire/release 自平衡，外层流程在
 * rebootstrap 完成后 release，所有调用路径在完整窗口内互斥。计数语义下
 * 多个调用方嵌套（如上层备份流程包住底层导出）不会互相提前清位；
 * `> 0` 即 busy。
 */

let maintenanceBusyCount = 0;

/** 数据清理/导入/导出/云同步是否进行中（后台搬运循环的让路守卫）。 */
export function isMobileDbMaintenanceBusy(): boolean {
  return maintenanceBusyCount > 0;
}

/** 进入一段互斥窗口时计数 +1（底层导出/导入函数与外层流程各自配对调用）。 */
export function acquireMobileDbMaintenanceBusy(): void {
  maintenanceBusyCount += 1;
}

/**
 * 离开互斥窗口时计数 -1（与 acquire 严格配对；兜底不降到负数，
 * 防御性钳制不影响正常配对路径）。
 */
export function releaseMobileDbMaintenanceBusy(): void {
  maintenanceBusyCount = Math.max(0, maintenanceBusyCount - 1);
}
