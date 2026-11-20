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
 *
 * 计数实现收在 `@novel-master/core/common` 的 Concurrency.createBusyFlag（mobile
 * 同名模块共用同一份）；本模块只负责桌面端实例化。
 */

import { Concurrency } from "@novel-master/core/common";

export const maintenanceBusy: ReturnType<typeof Concurrency.createBusyFlag> = Concurrency.createBusyFlag();
