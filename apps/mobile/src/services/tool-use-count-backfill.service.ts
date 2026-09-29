/**
 * Mobile tool_use_count 存量回填调度：runtime 就绪后低优先后台循环。
 *
 * core 侧 `runToolUseCountBackfill` 不感知运行守卫，本服务按端组合（与
 * message-content-compaction.service 同款）：Agent 活跃 / 数据清理 busy
 * 任一命中即暂停（批间检查，循环 5s 重试）。启动延迟 3s 让路首屏；每轮
 * 30s 同步预算，残余转后台续跑。幂等：完成标记已置时首轮零成本返回。
 *
 * @module services/tool-use-count-backfill
 */
import {
  DEFAULT_TOOL_USE_COUNT_SYNC_BUDGET_MS,
  runToolUseCountBackfill,
} from '@novel-master/core';
import {isMobileAgentActive} from '../runtime/agent-activity';
import {isMobileDbMaintenanceBusy} from './db-maintenance-busy';
import type {MobileNovelMasterRuntime} from '../runtime/types';

function mobileBackfillBlocked(): boolean {
  return isMobileAgentActive() || isMobileDbMaintenanceBusy();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMobileToolUseCountBackfillLoop(
  runtime: MobileNovelMasterRuntime,
): Promise<void> {
  try {
    // 低优先：让路首屏渲染、正文压缩搬运等更早的启动任务。
    await sleep(10_000);
    for (;;) {
      if (mobileBackfillBlocked()) {
        await sleep(5_000);
        continue;
      }
      const result = await runToolUseCountBackfill(runtime.conn, {
        syncBudgetMs: DEFAULT_TOOL_USE_COUNT_SYNC_BUDGET_MS,
        shouldPause: mobileBackfillBlocked,
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        console.warn(
          '[tool-use-count-backfill] 零进展护栏拦停，本进程停止重试，下次启动再试',
        );
        return;
      }
      await sleep(0);
    }
  } catch (err) {
    console.error('tool-use-count-backfill: mobile loop failed', err);
  }
}

/** 已挂载的 runtime（按连接身份去重，重复调度不叠加循环）。 */
let scheduledRuntime: MobileNovelMasterRuntime | undefined;

/** runtime 就绪后挂调度（不 await，不阻塞 ready）。 */
export function scheduleMobileToolUseCountBackfill(
  runtime: MobileNovelMasterRuntime,
): void {
  if (scheduledRuntime === runtime) {
    return;
  }
  scheduledRuntime = runtime;
  void runMobileToolUseCountBackfillLoop(runtime).finally(() => {
    if (scheduledRuntime === runtime) {
      scheduledRuntime = undefined;
    }
  });
}
