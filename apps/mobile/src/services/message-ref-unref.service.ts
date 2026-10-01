/**
 * Mobile 引用化回迁调度（存量 contentRef 行 → 明文包 + 源 revision −1）：
 * runtime 就绪后低优先后台循环。
 *
 * core 侧 `runMessageRefUnref` 不感知运行守卫，本服务按端组合：Agent 活跃 /
 * 数据清理（含导入导出/云同步）busy 任一命中即暂停（批间检查，循环 5s 重试）。
 * 启动延迟 3s 低优先让路首屏渲染；每轮 60s 同步预算，重度库残余转后台续跑。
 *
 * 调度去重与解压/blob 归一侧同款 runtime 身份去重：同一 runtime 重复调度不
 * 叠加循环；retry 换新 runtime 时对新连接重挂一次，旧循环随旧连接失效自然
 * 终止。
 *
 * **两个停手出口（deferred 与 stalled 同款，本进程收手）**：
 * - `stalled = true`：零进展护栏 / 收尾谓词校验拦停，继续立即重跑也不会有
 *   任何进展 → 收手等下个冷启动，否则零延迟续跑会把空转放大成无界热循环。
 * - `deferred = true`：解压兄弟任务的完成标记未置、判据还不成立。本进程里
 *   解压任务自己会收敛，这里收手等下个冷启动；**不零延迟续轮**（那只是空
 *   转，解压不在本循环里跑）。
 *
 * @module services/message-ref-unref
 */
import {
  DEFAULT_REF_UNREF_SYNC_BUDGET_MS,
  runMessageRefUnref,
} from '@novel-master/core';
import {isMobileAgentActive} from '../runtime/agent-activity';
import {isMobileDbMaintenanceBusy} from './db-maintenance-busy';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** 运行守卫：Agent 活跃即暂停 + 数据清理/备份互斥（与解压兄弟任务同款）。 */
function mobileRefUnrefBlocked(): boolean {
  return isMobileAgentActive() || isMobileDbMaintenanceBusy();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 回迁循环：热身让路 → 逐轮调 core（单轮内自带 60s 同步预算）→ 守卫命中
 * 则退避重试、未跑完则零延迟续跑、全部完成即收手。
 *
 * 任何一轮抛错都只 console.error 后 return：回迁是幂等的纯迁移，下一轮 app
 * 启动会按谓词续扫，用户无感知；上抛反而会污染启动链路。
 */
async function runMobileMessageRefUnrefLoop(
  runtime: MobileNovelMasterRuntime,
): Promise<void> {
  try {
    // 低优先：让路首屏渲染与 runtime 水合。
    await sleep(3_000);
    for (;;) {
      if (mobileRefUnrefBlocked()) {
        await sleep(5_000);
        continue;
      }
      const result = await runMessageRefUnref(runtime.conn, {
        syncBudgetMs: DEFAULT_REF_UNREF_SYNC_BUDGET_MS,
        shouldPause: mobileRefUnrefBlocked,
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        console.warn(
          '[message-ref-unref] 回迁零进展（护栏/收尾校验拦停），本进程停止重试，下次启动再试',
        );
        return;
      }
      if (result.deferred) {
        // 解压兄弟任务未完成 → 让位停手，与 stalled 同款处置（warn 后
        // return 等下个冷启动），不 sleep(0) 续轮。
        console.warn(
          '[message-ref-unref] 解压任务未完成（deferred），本进程停止重试，下次启动按 KKV 重试',
        );
        return;
      }
      await sleep(0);
    }
  } catch (err) {
    console.error('message-ref-unref: mobile loop failed', err);
  }
}

/** 已挂载的 runtime（按连接身份去重，保证重复调用不叠加循环）。 */
let scheduledRuntime: MobileNovelMasterRuntime | undefined;

/**
 * runtime 就绪后挂调度（不 await，不阻塞 ready）。
 *
 * 同一 runtime 重复调度不叠加循环；retry 换新 runtime 时对新连接重挂一次。
 * 任务幂等：已完成（KKV 标记已置）时首轮即零成本返回。
 */
export function scheduleMobileMessageRefUnref(
  runtime: MobileNovelMasterRuntime,
): void {
  if (scheduledRuntime === runtime) {
    return;
  }
  scheduledRuntime = runtime;
  void runMobileMessageRefUnrefLoop(runtime).finally(() => {
    // 循环收手后释放登记键（条件复位：若期间已换新 runtime 重挂，
    // 登记键属新 runtime，不得抹掉）。
    if (scheduledRuntime === runtime) {
      scheduledRuntime = undefined;
    }
  });
}