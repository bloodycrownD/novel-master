/**
 * Desktop 消息正文解压搬运调度（反向任务）：main 就绪后预算制后台循环。
 *
 * core 侧 `runMessageContentDecompress` 不感知运行守卫，本服务按端组合：
 * Agent 活跃 / 数据清理 busy / 云同步 busy 任一命中即暂停（批间检查，
 * 循环 5s 重试）。better-sqlite3 无量子让步，靠任务批间 setTimeout(0)
 * 让步 main 事件循环；每轮 60s 同步预算（升级首启残余转后台续跑的
 * 口径——首轮即预算制后台，不阻塞 app 启动）。
 *
 * **连接被 rebootstrap 换掉时本任务视为可重挂**（ic-02）：每轮循环首行
 * 重取 runtime，轮内「connection is not open」类错误不算失败收手——warn
 * 后退避重试，下一轮换到重建后的新连接，远端库回灌后重新解压。
 * `stalled = true` 表示收尾谓词校验判定谓词内仍有非坏行残留（三种成因：
 * 原地打转的 UPDATE 恒 `changes = 0` / 并发端抢写 / 驱动写回被拒）→
 * 本进程停手、下个冷启动按谓词重扫。
 *
 * **反向任务不挂 VACUUM**（解压是增容、无 freelist 可归还），故本服务的
 * beforeMaintenance/afterMaintenance 只在消费正向任务遗留的
 * `startupMaintenancePending` 欠账时触发一次补跑维护。
 *
 * @module services/message-content-decompression
 */
import {
  DEFAULT_DECOMPRESS_SYNC_BUDGET_MS,
  runMessageContentDecompress,
} from "@novel-master/core";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";
import {
  isDesktopDbMaintenanceBusy,
  setDesktopDbMaintenanceBusy,
} from "./db-maintenance-busy.js";

/** 运行守卫：与备份/云同步/数据清理互斥（spec 拍板的三守卫组合）。 */
function desktopDecompressBlocked(): boolean {
  return (
    isDesktopAgentActive() ||
    isDesktopDbMaintenanceBusy() ||
    isDesktopCloudSyncBusy()
  );
}

/** 判「连接已关闭」类错误（rebootstrap 关连接后驱动抛出的 not open 家族）。 */
function isConnectionClosedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes("connection is not open") || lower.includes("not open")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 守卫命中退避（ms）。 */
const GUARD_RETRY_DELAY_MS = 5_000;

/** 连接重建退避（ms）：轮内撞上「连接已关」给 rebootstrap 一个完成窗口。 */
const RECONNECT_RETRY_DELAY_MS = 1_000;

/**
 * 调度解压搬运循环（fire-and-forget，启动挂一次）。
 *
 * 任务幂等：已完成（KKV 标记已置）时首轮即零成本返回；未完成则每轮
 * 预算制搬运直至收敛。失败只记日志不重抛——下次启动幂等重试。
 *
 * 每轮首行重取 runtime（ic-02）：轮内 try 只包单轮调用，抛错分流——
 * 「连接已关闭」→ warn 后退避 continue（下一轮换新连接自然重挂）；
 * 其它真失败 → warn 后 return（本进程收手，下次启动幂等重试）。
 */
export async function runDesktopMessageContentDecompressLoop(): Promise<void> {
  for (;;) {
    try {
      // 每轮重取 runtime：rebootstrap 换连接后本轮即切到新连接（ic-02），
      // 不需要外层感知重挂。
      const runtime = await getDesktopRuntime();
      if (desktopDecompressBlocked()) {
        await sleep(GUARD_RETRY_DELAY_MS);
        continue;
      }
      const result = await runMessageContentDecompress(runtime.conn, {
        syncBudgetMs: DEFAULT_DECOMPRESS_SYNC_BUDGET_MS,
        shouldPause: desktopDecompressBlocked,
        // 本任务自身不跑维护链路；这两个回调只在**消费旧 pending 欠账**
        // （补跑一次去重版维护）时触发。借回调只包住真正会冻结 main 的
        // 那一段置位（与手动 runDbMaintenance 是同一条纪律的两处落点）；
        // afterMaintenance 为 finally 语义，抛错也复位。
        // 不自锁理由：busy 守卫在每轮 await 之前检查，维护回调在
        // runMessageContentDecompress 调用内部触发且返回前已复位——
        // 下一轮守卫读到的是 false。
        beforeMaintenance: () => setDesktopDbMaintenanceBusy(true),
        afterMaintenance: () => setDesktopDbMaintenanceBusy(false),
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        // 收尾谓词校验判定谓词内仍有非坏行残留（原地打转的 UPDATE 恒
        // changes=0 / 并发端抢写 / 驱动写回被拒）→ 本进程停手、下个冷启动
        // 按谓词重扫。
        console.warn(
          "[desktop] 消息正文解压收尾谓词校验仍有非坏行残留（打转/并发抢写/写回被拒），本进程停手，下个冷启动按谓词重扫",
        );
        return;
      }
      // 预算耗尽残余（重度库）或守卫中断：转后台继续下一轮。
      await sleep(0);
    } catch (error) {
      if (isConnectionClosedError(error)) {
        // 连接被 rebootstrap（备份导入/云同步 pull）换掉：不算失败收手，
        // 退避一拍让重建流程走完，下一轮重取 runtime 拿新连接自然重挂，
        // 远端库回灌后重新解压。
        console.warn(
          "[desktop] 消息正文解压轮内连接被关闭（疑似 rebootstrap），退避后换新连接重挂：",
          error instanceof Error ? error.message : error,
        );
        await sleep(RECONNECT_RETRY_DELAY_MS);
        continue;
      }
      console.warn(
        "[desktop] 消息正文解压搬运失败（不阻断，下次启动幂等重试）:",
        error,
      );
      return;
    }
  }
}

/** main 就绪后挂调度（不 await，不阻塞启动）。 */
export function scheduleDesktopMessageContentDecompress(): void {
  void runDesktopMessageContentDecompressLoop().catch(() => undefined);
}
