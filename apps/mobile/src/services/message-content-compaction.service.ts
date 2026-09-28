/**
 * Mobile 消息正文压缩搬运调度：runtime 就绪后低优先后台循环。
 *
 * core 侧 `runMessageContentCompaction` 不感知运行守卫，本服务按端组合：
 * Agent 活跃 / 数据清理（含导入导出/云同步）busy 任一命中即暂停（批间
 * 检查，循环 5s 重试）。启动延迟 3s 低优先让路首屏渲染；每轮 60s 同步
 * 预算，重度库残余转后台续跑。写侧恒二进制 zlib（无平台分支；存量
 * zlib-b64 脏形态由读路径 codec 运行时探测兼容）。
 *
 * 调度去重与 blob 归一侧同款 runtime 身份去重：同一 runtime 重复调度
 * 不叠加循环；retry 换新 runtime 时对新连接重挂一次，旧循环随旧连接
 * 失效自然终止。
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
 * 压缩搬运循环：热身让路 → 逐轮调 core（单轮内自带 60s 同步预算）→
 * 守卫命中则退避重试、未跑完则零延迟续跑、全部完成即收手。
 *
 * 任何一轮抛错都只 console.error 后 return：压缩是幂等的纯优化，
 * 下一轮 app 启动会按谓词续扫，用户无感知；上抛反而会污染启动链路。
 * `stalled = true`（零进展护栏/收尾谓词校验拦停）同样 warn 后 return：
 * 本进程不再重试（下个冷启动再试），否则零延迟续跑会把空转放大成
 * 无界热循环。
 */
async function runMobileMessageContentCompactionLoop(
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
      if (result.stalled) {
        // 零进展护栏收手：谓词反复命中同一批行、UPDATE 恒 changes=0，
        // 立刻续跑也不会有任何进展。这里必须收手（本进程不再重试、下个
        // 冷启动再试），对齐 blob 归一侧的 stalled 处置口径。
        console.warn(
          '[message-content-compaction] 压缩零进展（护栏拦停），本进程停止重试，下次启动再试',
        );
        return;
      }
      await sleep(0);
    }
  } catch (err) {
    console.error('message-content-compaction: mobile loop failed', err);
  }
}

/** 已挂载的 runtime（按连接身份去重，保证重复调用不叠加循环）。 */
let scheduledRuntime: MobileNovelMasterRuntime | undefined;

/**
 * runtime 就绪后挂调度（不 await，不阻塞 ready）。
 *
 * 同一 runtime 重复调度不叠加循环；retry 换新 runtime 时对新连接重挂
 * 一次。任务幂等：已完成（KKV 标记已置）时首轮即零成本返回。
 */
export function scheduleMobileMessageContentCompaction(
  runtime: MobileNovelMasterRuntime,
): void {
  if (scheduledRuntime === runtime) {
    return;
  }
  scheduledRuntime = runtime;
  void runMobileMessageContentCompactionLoop(runtime).finally(() => {
    // 循环收手后释放登记键（条件复位：若期间已换新 runtime 重挂，
    // 登记键属新 runtime，不得抹掉）。
    if (scheduledRuntime === runtime) {
      scheduledRuntime = undefined;
    }
  });
}
