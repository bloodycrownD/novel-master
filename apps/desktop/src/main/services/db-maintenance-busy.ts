/**
 * 数据清理（VACUUM）进程级忙碌状态：独立小模块持有。
 *
 * 抽成零依赖模块的原因：db-maintenance.service 需要读 cloud-sync 的
 * syncBusy，而 cloud-sync 的 getLocalStatus 又要回报 maintenanceBusy，
 * 两侧互相引用会形成循环 import——把状态收敛到这里，依赖即成单向
 * （db-maintenance.service 与 cloud-sync.service 都只依赖本模块）。
 *
 * busy 为**计数/令牌配对**语义（ic-20）：底层函数（备份导出/导入、云同步
 * snapshot 搬运）入口 acquire、出口 finally release 自平衡；最外层流程
 * （备份导入 / 云同步 pull）在 rebootstrap 完成之后 release——含「库文件
 * 已替换、连接仍处重建窗口」的完整互斥。计数 >0 即 busy，多个调用方嵌套
 * 不会互相提前清位（旧的纯布尔置位会被嵌套调用的外层复位提前解锁）。
 */

let maintenanceBusyCount = 0;

/** 数据清理是否进行中（供 getLocalStatus 回报与 UI 禁用判断）。 */
export function isDesktopDbMaintenanceBusy(): boolean {
  return maintenanceBusyCount > 0;
}

/** 计数 acquire：忙碌令牌 +1（与 release 严格配对使用）。 */
export function acquireDesktopDbMaintenanceBusy(): void {
  maintenanceBusyCount += 1;
}

/**
 * 计数 release：忙碌令牌 -1，与 {@link acquireDesktopDbMaintenanceBusy}
 * 配对；下限 0 防御（多释放不产生负计数把后续 acquire 提前抵消）。
 */
export function releaseDesktopDbMaintenanceBusy(): void {
  maintenanceBusyCount = Math.max(0, maintenanceBusyCount - 1);
}

/**
 * 置位入口（兼容旧调用形态）：true = acquire、false = release。
 *
 * 旧布尔语义的既有消费方（手动清理 runDbMaintenance、归一/压缩的维护段
 * 回调）都是「进 true / finally false」的对称写法，在计数语义下等价保持。
 */
export function setDesktopDbMaintenanceBusy(busy: boolean): void {
  if (busy) {
    acquireDesktopDbMaintenanceBusy();
  } else {
    releaseDesktopDbMaintenanceBusy();
  }
}

/** 测试用：复位忙碌计数。 */
export function resetDesktopDbMaintenanceBusyForTest(): void {
  maintenanceBusyCount = 0;
}
