/**
 * Desktop 端 VFS 非 head 历史版本混合打包（zlib-concat / fossil 链）调度服务。
 *
 * 打包算法与候选谓词全在 core（{@link runVfsContentPacking}），本模块
 * 只负责「什么时候跑、在什么条件下让路」，骨架与收手口径照
 * `blob-binary-normalization.service` 同款：
 *
 * - **无延迟直接进循环**：main 侧启动时库已就绪，第一轮立即开跑，不额外
 *   sleep 3s 之类的冷启动延迟。循环内每轮重新取 runtime：runtime 被重建
 *   （rebootstrap）时会自动切到新连接。
 * - **组合守卫**：Agent 运行中 / 云同步进行中 / 数据清理进行中，任一命中就
 *   `sleep(5000)` 后重试。守卫既在本模块的轮次入口判，也通过
 *   `shouldPause` 交给 core 在组间再判一次——长批不会在守卫窗口内跑穿。
 * - **beforeMaintenance/afterMaintenance 回调缝**（cr-03 + ic-01c 同款）：
 *   core 的收尾维护链路（GC/checkpoint/VACUUM）里 better-sqlite3 的 VACUUM
 *   同步执行、冻结 main 事件循环——core 不感知 app 的 busy 状态，由这里
 *   借回调只包住真正会冻结的那一段置位；afterMaintenance 为 finally 语义，
 *   VACUUM 抛错也复位。不自锁理由：shouldPause 的 busy 守卫只在组间检查，
 *   此时维护段尚未开始；before 置位发生在本轮组间检查之后、after 在 core
 *   返回前已复位——下一轮守卫（含 shouldPause）读到的恒是 false。
 * - `done === false`（同步预算耗尽 / 守卫暂停）→ `sleep(0)` 交还事件循环
 *   续跑；`stalled === true`（剩余候选 > 坏组数：打转 / 并发抢写）→
 *   `console.warn` 后**本进程停手**（`sleep(0)` 续跑只会把空转放大成无界
 *   热循环），下个冷启动按谓词重扫再试；`done === true`（本轮收敛）→
 *   收工返回。**与 blob 归一的分叉**：打包无终态完成标记，新写入的历史
 *   版本会持续攒出新候选组——本进程照旧收工（常驻轮询重扫候选谓词的
 *   收益不抵 IO），新组由下次冷启动（进程内重新调度时）再起循环收敛。
 * - **失败不上抛**：后台任务不参与启动成败判定，只 `console.warn`。打包
 *   任务本身可重入（谓词驱动，重启续跑；已落库的 pack 永不重写）。
 *   **重挂边界 = 轮内自愈**：连接被换掉（备份导入 / 云同步 pull 的
 *   rebootstrap）时，若本条循环**还在跑**，「connection is not open」类
 *   错误不算失败收手——warn 后退避一拍、下一轮重取 runtime 拿新连接继续
 *   整理远端回灌的库。**循环已收手（done / stalled / 真失败）则不再
 *   主动重挂**，等下次冷启动重新收敛——与 blob 归一 / 消息压缩同款边界
 *   （本模块不订阅 rebootstrap 事件，rebootstrap 本身不触发重挂）。
 *
 * @module services/vfs-content-packing
 */
import { runVfsContentPacking } from "@novel-master/core";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import {
  isDesktopDbMaintenanceBusy,
  setDesktopDbMaintenanceBusy,
} from "./db-maintenance-busy.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";

/** 守卫命中后的重试间隔（ms）：让 Agent 回合 / 云同步 / 清理有完整窗口。 */
const GUARD_RETRY_DELAY_MS = 5000;

/** 连接重建退避（ms）：轮内撞上「连接已关」给 rebootstrap 一个完成窗口。 */
const RECONNECT_RETRY_DELAY_MS = 1000;

/** 是否应让路：Agent 运行 / 云同步 / 数据清理任一进行中即为 true。 */
function isDesktopBusyForVfsPacking(): boolean {
  return (
    isDesktopAgentActive() ||
    isDesktopCloudSyncBusy() ||
    isDesktopDbMaintenanceBusy()
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

/**
 * 循环执行打包任务直到本轮收敛（不抛错）。
 *
 * 循环内**每轮重新取 runtime**：runtime 被重建（rebootstrap）时会自动切到
 * 新连接，不需要外层感知。
 *
 * 收手口径：本轮收敛（`done = true`）返回；`stalled = true` → `console.warn`
 * 后返回（本进程停手、下个冷启动按谓词重扫）；预算耗尽 / 守卫暂停照旧
 * 零延迟续跑下一轮。
 *
 * 轮内抛错分流（cr-05 同款）：「连接已关闭」→ warn 后 `continue`（下一轮
 * 重取 runtime 拿新连接，自然重挂）；其它真失败 → warn 后 return（本进程
 * 收手，下次启动幂等重试）。
 */
async function runDesktopVfsContentPacking(): Promise<void> {
  for (;;) {
    if (isDesktopBusyForVfsPacking()) {
      await sleep(GUARD_RETRY_DELAY_MS);
      continue;
    }
    try {
      const runtime = await getDesktopRuntime();
      const result = await runVfsContentPacking(runtime.conn, {
        // 组间再判一次守卫：避免单轮长时间独占 main 事件循环。
        shouldPause: isDesktopBusyForVfsPacking,
        // 收尾维护段（VACUUM）只在这里置 busy——置位/复位口径与
        // scheduleDesktopBlobBinaryNormalization 的回调缝同一纪律。
        beforeMaintenance: () => setDesktopDbMaintenanceBusy(true),
        afterMaintenance: () => setDesktopDbMaintenanceBusy(false),
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        // 收尾校验判定剩余候选 entry 数 > failedGroups（打转/并发抢写）
        // → 本进程停手、下个冷启动按谓词重扫。
        console.warn(
          "[desktop] VFS 历史版本打包收尾校验发现候选未收敛（打转/并发抢写），本进程停手，下个冷启动按谓词重扫",
        );
        return;
      }
      // 预算耗尽/被守卫打断：让出事件循环立刻续跑下一轮。
      await sleep(0);
    } catch (err) {
      if (isConnectionClosedError(err)) {
        // 连接被 rebootstrap（备份导入/云同步 pull）换掉：不算失败收手，
        // 退避一拍让重建流程走完，下一轮重取 runtime 拿新连接自然重挂，
        // 远端库回灌后重新打包。
        console.warn(
          "[desktop] VFS 历史版本打包轮内连接被关闭（疑似 rebootstrap），退避后换新连接重挂：",
          err instanceof Error ? err.message : err,
        );
        await sleep(RECONNECT_RETRY_DELAY_MS);
        continue;
      }
      console.warn(
        "[desktop] VFS 历史版本打包失败，下次启动重试：",
        err instanceof Error ? err.message : err,
      );
      return;
    }
  }
}

/** 挂载标记：按 runtime 身份去重（cr-05 方案 A），同一 runtime 只挂一条循环。 */
let scheduledRuntime: DesktopNovelMasterRuntime | null = null;

/**
 * 启动后挂载 VFS 历史版本打包（fire-and-forget，不阻塞启动）。
 *
 * 幂等：同一 runtime 重复调度不叠加循环（去重键 = runtime 连接身份，循环
 * 退出即 finally 释放）。**重挂边界**：rebootstrap 换掉连接时，**仅当这条
 * 循环还在跑**才会靠轮内自愈退避重挂新 runtime（见模块头「重挂边界」条）；
 * 本函数不订阅 rebootstrap 事件——循环已收手后没有「再挂一次」，回灌库里
 * 的未打包存量版本等下次冷启动重新收敛（读路径按 pack format 分派，未打包
 * 的 blob 行照常读，无正确性影响；存储页状态行会如实显示「剩余 N 组」）。
 */
export function scheduleDesktopVfsContentPacking(): void {
  void (async () => {
    const runtime = await getDesktopRuntime();
    if (scheduledRuntime === runtime) {
      return;
    }
    scheduledRuntime = runtime;
    try {
      await runDesktopVfsContentPacking();
    } finally {
      // 循环退出即清键：防「失败收手后身份键挂死」阻断后续重挂；done 正常
      // 收工后再调度也是幂等空转（core 首轮零候选即返回 done）。
      if (scheduledRuntime === runtime) {
        scheduledRuntime = null;
      }
    }
  })();
}
