/**
 * Desktop tool_use_count 存量回填调度：main 就绪后低优先后台循环。
 *
 * 与 message-content-compaction.service 同款骨架（守卫组合 / 连接重建
 * 退避 / stalled 收手），但无维护链路段（core 侧本任务不挂 VACUUM）。
 * 幂等：完成标记已置时首轮零成本返回。
 *
 * @module services/tool-use-count-backfill
 */
import {
  DEFAULT_TOOL_USE_COUNT_SYNC_BUDGET_MS,
  runToolUseCountBackfill,
} from "@novel-master/core";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";
import { isDesktopDbMaintenanceBusy } from "./db-maintenance-busy.js";

function desktopBackfillBlocked(): boolean {
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

async function runDesktopToolUseCountBackfillLoop(): Promise<void> {
  for (;;) {
    try {
      const runtime = await getDesktopRuntime();
      if (desktopBackfillBlocked()) {
        await sleep(5_000);
        continue;
      }
      const result = await runToolUseCountBackfill(runtime.conn, {
        syncBudgetMs: DEFAULT_TOOL_USE_COUNT_SYNC_BUDGET_MS,
        shouldPause: desktopBackfillBlocked,
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        console.warn(
          "[desktop] tool_use_count 回填零进展/残留拦停，本进程停手，下个冷启动按谓词重扫",
        );
        return;
      }
      await sleep(0);
    } catch (error) {
      if (isConnectionClosedError(error)) {
        await sleep(1_000);
        continue;
      }
      console.warn(
        "[desktop] tool_use_count 回填失败（不阻断，下次启动幂等重试）:",
        error,
      );
      return;
    }
  }
}

/** main 就绪后挂调度（不 await，不阻塞启动）。 */
export function scheduleDesktopToolUseCountBackfill(): void {
  void runDesktopToolUseCountBackfillLoop().catch(() => undefined);
}
