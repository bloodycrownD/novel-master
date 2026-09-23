/**
 * Mobile 消息正文压缩搬运调度：runtime 就绪后低优先后台循环。
 *
 * core 侧 `runMessageContentCompaction` 不感知运行守卫，本服务按端组合：
 * Agent 活跃 / 数据清理（含导入导出）busy 任一命中即暂停（批间检查，
 * 循环 5s 重试）。启动延迟 3s 低优先让路首屏渲染；每轮 60s 同步预算，
 * 重度库残余转后台续跑。RN 侧任务编码走 zlib-b64（codec 运行时探测）。
 *
 * @module services/message-content-compaction
 */
import {
  DEFAULT_COMPACTION_SYNC_BUDGET_MS,
  runMessageContentCompaction,
} from '@novel-master/core';
import {isMobileAgentActive} from '../runtime/agent-activity';
import {isMobileDbMaintenanceBusy} from './db-maintenance-busy';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** 运行守卫：Agent 活跃即暂停（spec 拍板）+ 数据清理/备份互斥。 */
function mobileCompactionBlocked(): boolean {
  return isMobileAgentActive() || isMobileDbMaintenanceBusy();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 调度压缩搬运循环（fire-and-forget，runtime 就绪后挂一次）。
 *
 * 任务幂等：已完成（KKV 标记已置）时首轮即零成本返回。失败只
 * console.error——下次启动幂等重试，不向上抛。
 */
export async function runMobileMessageContentCompactionLoop(
  runtime: MobileNovelMasterRuntime,
): Promise<void> {
  try {
    // 低优先：让路首屏渲染与 runtime 水合。
    await sleep(3_000);
    for (;;) {
      if (mobileCompactionBlocked()) {
        await sleep(5_000);
        continue;
      }
      const result = await runMessageContentCompaction(runtime.conn, {
        syncBudgetMs: DEFAULT_COMPACTION_SYNC_BUDGET_MS,
        shouldPause: mobileCompactionBlocked,
      });
      if (result.done) {
        return;
      }
      await sleep(0);
    }
  } catch (err) {
    console.error('message-content-compaction: mobile loop failed', err);
  }
}

/** runtime 就绪后挂调度（不 await，不阻塞 ready）。 */
export function scheduleMobileMessageContentCompaction(
  runtime: MobileNovelMasterRuntime,
): void {
  void runMobileMessageContentCompactionLoop(runtime);
}
