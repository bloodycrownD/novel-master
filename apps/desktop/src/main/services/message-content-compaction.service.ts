/**
 * Desktop 消息正文压缩搬运调度：main 就绪后预算制后台循环。
 *
 * core 侧 `runMessageContentCompaction` 不感知运行守卫，本服务按端组合：
 * Agent 活跃 / 数据清理 busy / 云同步 busy 任一命中即暂停（批间检查，
 * 循环 5s 重试）。better-sqlite3 无量子让步，靠任务批间 setTimeout(0)
 * 让步 main 事件循环；每轮 60s 同步预算（升级首启残余转后台续跑的
 * 口径——首轮即预算制后台，不阻塞 app 启动）。
 *
 * @module services/message-content-compaction
 */
import {
  DEFAULT_COMPACTION_SYNC_BUDGET_MS,
  runMessageContentCompaction,
} from "@novel-master/core";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";
import { isDesktopDbMaintenanceBusy } from "./db-maintenance-busy.js";

/** 运行守卫：与备份/云同步/数据清理互斥（spec 拍板的三守卫组合）。 */
function desktopCompactionBlocked(): boolean {
  return (
    isDesktopAgentActive() ||
    isDesktopDbMaintenanceBusy() ||
    isDesktopCloudSyncBusy()
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 调度压缩搬运循环（fire-and-forget，启动挂一次）。
 *
 * 任务幂等：已完成（KKV 标记已置）时首轮即零成本返回；未完成则每轮
 * 预算制搬运直至收敛（完成后 core 侧自动挂一次维护链路 VACUUM）。
 * 失败只记日志不重抛——下次启动幂等重试。
 */
export async function runDesktopMessageContentCompactionLoop(): Promise<void> {
  try {
    const runtime = await getDesktopRuntime();
    for (;;) {
      if (desktopCompactionBlocked()) {
        await sleep(5_000);
        continue;
      }
      const result = await runMessageContentCompaction(runtime.conn, {
        syncBudgetMs: DEFAULT_COMPACTION_SYNC_BUDGET_MS,
        shouldPause: desktopCompactionBlocked,
      });
      if (result.done) {
        return;
      }
      // 预算耗尽残余（重度库）或守卫中断：转后台继续下一轮。
      await sleep(0);
    }
  } catch (error) {
    console.warn(
      "[desktop] 消息正文压缩搬运失败（不阻断，下次启动幂等重试）:",
      error
    );
  }
}

/** main 就绪后挂调度（不 await，不阻塞启动）。 */
export function scheduleDesktopMessageContentCompaction(): void {
  void runDesktopMessageContentCompactionLoop();
}
