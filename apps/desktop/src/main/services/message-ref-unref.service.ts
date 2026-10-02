/**
 * Desktop 引用化回迁调度（存量 contentRef 行 → 明文包 + 源 revision −1）。
 *
 * core 侧 `runMessageRefUnref` 不感知运行守卫，本服务按端组合：Agent 活跃 /
 * 数据清理 busy / 云同步 busy 任一命中即暂停（批间检查，循环 5s 重试）。
 * better-sqlite3 无量子让步，靠任务批间 setTimeout(0) 让步 main 事件循环；
 * 每轮 60s 同步预算（升级首启残余转后台续跑——首轮即预算制后台，不阻塞 app
 * 启动）。
 *
 * **连接被 rebootstrap 换掉时本任务视为可重挂**（与解压兄弟任务同款）：每轮
 * 循环首行重取 runtime，轮内「connection is not open」类错误不算失败收手
 * ——warn 后退避重试，下一轮换到重建后的新连接，远端库回灌后重新回迁。
 *
 * **两个停手出口（deferred 与 stalled 同款，本进程收手、下个冷启动再试）**：
 * - `stalled = true`：零进展护栏 / 收尾谓词校验判定谓词内仍有非失败行残留
 *   （原地打转的 UPDATE 恒 `changes = 0` / 并发端抢写 / 驱动写回被拒）。
 * - `deferred = true`：解压兄弟任务的完成标记未置，判据还不成立。本进程里
 *   解压任务会自己收敛，所以这里**必须收手等下个冷启动**——绝不能像预算
 *   耗尽那样零延迟续轮，那只会空转到下一个冷启动（空转成忙循环）。
 *
 * **不挂 VACUUM**：回迁是增容（明文包比占位空串大得多），库里没有可归还的
 * freelist 页，VACUUM 只会全库重写、白烧一次同步阻塞。
 *
 * @module services/message-ref-unref
 */
import {
  DEFAULT_REF_UNREF_SYNC_BUDGET_MS,
  runMessageRefUnref,
} from "@novel-master/core";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";
import { isDesktopDbMaintenanceBusy } from "./db-maintenance-busy.js";

/** 运行守卫：与备份/云同步/数据清理互斥（与解压兄弟任务同款三守卫组合）。 */
function desktopRefUnrefBlocked(): boolean {
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
 * 调度引用化回迁循环（fire-and-forget，启动挂一次）。
 *
 * 任务幂等：已完成（KKV 标记已置）时首轮即零成本返回；未完成则每轮预算制
 * 回迁直至收敛。失败只记日志不重抛——下次启动幂等重试。
 *
 * 每轮首行重取 runtime：轮内 try 只包单轮调用，抛错分流——「连接已关闭」
 * → warn 后退避 continue（下一轮换新连接自然重挂）；其它真失败 → warn 后
 * return（本进程收手，下次启动幂等重试）。
 */
export async function runDesktopMessageRefUnrefLoop(): Promise<void> {
  for (;;) {
    try {
      // 每轮重取 runtime：rebootstrap 换连接后本轮即切到新连接，不需要
      // 外层感知重挂。
      const runtime = await getDesktopRuntime();
      if (desktopRefUnrefBlocked()) {
        await sleep(GUARD_RETRY_DELAY_MS);
        continue;
      }
      const result = await runMessageRefUnref(runtime.conn, {
        syncBudgetMs: DEFAULT_REF_UNREF_SYNC_BUDGET_MS,
        shouldPause: desktopRefUnrefBlocked,
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        console.warn(
          "[desktop] 引用化回迁移尾谓词校验仍有非失败行残留（打转/并发抢写/写回被拒），本进程停手，下个冷启动按谓词重扫",
        );
        return;
      }
      if (result.deferred) {
        // 解压兄弟任务的完成标记未置：本进程内它自己会收敛，这里收手等下个
        // 冷启动。零延迟续轮只会空转（解压不在本循环里跑）。
        console.warn(
          "[desktop] 引用化回迁因解压任务未完成而让位停手，本进程不再重试，下次冷启动按 KKV 重试",
        );
        return;
      }
      // 预算耗尽残余（重度库）或守卫中断：转后台继续下一轮。
      await sleep(0);
    } catch (error) {
      if (isConnectionClosedError(error)) {
        console.warn(
          "[desktop] 引用化回迁轮内连接被关闭（疑似 rebootstrap），退避后换新连接重挂：",
          error instanceof Error ? error.message : error,
        );
        await sleep(RECONNECT_RETRY_DELAY_MS);
        continue;
      }
      console.warn(
        "[desktop] 引用化回迁失败（不阻断，下次启动幂等重试）:",
        error,
      );
      return;
    }
  }
}

/** main 就绪后挂调度（不 await，不阻塞启动）。 */
export function scheduleDesktopMessageRefUnref(): void {
  void runDesktopMessageRefUnrefLoop().catch(() => undefined);
}
