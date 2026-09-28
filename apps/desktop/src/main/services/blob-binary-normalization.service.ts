/**
 * Desktop 端存量 blob 形态归一（zlib-b64 base64 文本 → 二进制 BLOB）调度服务。
 *
 * 归一算法与完成标记全在 core（{@link runBlobBinaryNormalization}），本模块
 * 只负责「什么时候跑、在什么条件下让路」：
 *
 * - **无延迟直接进循环**：main 侧启动时库已就绪，第一轮立即开跑，不额外
 *   sleep 3s 之类的冷启动延迟。循环内每轮重新取 runtime：runtime 被重建
 *   （rebootstrap）时会自动切到新连接。
 * - **组合守卫**：Agent 运行中 / 云同步进行中 / 数据清理进行中，任一命中就
 *   `sleep(5000)` 后重试。守卫既在本模块的轮次入口判，也通过
 *   `shouldPause` 交给 core 在批间再判一次——长批不会在守卫窗口内跑穿。
 * - `done === false`（同步预算耗尽 / 守卫暂停）→ `sleep(0)` 交还事件循环
 *   续跑；`stalled === true` → `console.warn` 后**本进程停手**（`sleep(0)`
 *   续跑只会把空转放大成无界热循环），下个冷启动按谓词重扫再试；
 *   `done === true` → 收工返回。core 内部在全部完成时挂一次维护链路
 *   （带进程级去重，且 VACUUM 失败只 warn 不上抛），app 侧不直接调。
 * - **stalled 口径（语义已扩宽）**：`stalled = true` 表示收尾谓词校验判定
 *   谓词内仍有非坏行残留（三种成因：原地打转的 UPDATE 恒 `changes = 0` /
 *   并发端抢写 / 降级期新写入的 legacy 行）→ 本进程停手、下个冷启动按谓词
 *   重扫。扩宽后的取舍是本会话不再推进、下次冷启动重扫，无正确性损失
 *   ——已完成改写的行不会回退，只是节奏变慢。
 * - **失败不上抛**：后台任务不参与启动成败判定，只 `console.warn`。归一
 *   任务本身可重入（谓词驱动，重启续跑），下个冷启动自然会再试。**连接被
 *   rebootstrap（备份导入 / 云同步 pull）换掉时本任务视为可重挂**：去重键
 *   = runtime 连接身份（cr-05 方案 A），且「connection is not open」类错误
 *   不算失败收手——warn 后下一轮重取 runtime 拿新连接，远端库回灌后
 *   重新整理。
 *
 * @module services/blob-binary-normalization
 */
import { runBlobBinaryNormalization } from "@novel-master/core";
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
function isDesktopBusyForBlobBinary(): boolean {
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
 * 循环执行归一任务直到全部完成（不抛错）。
 *
 * 循环内**每轮重新取 runtime**：runtime 被重建（rebootstrap）时会自动切到
 * 新连接，不需要外层感知。
 *
 * 收手口径：完成（`done = true`）返回；`stalled = true` 表示收尾谓词校验
 * 判定谓词内仍有非坏行残留（三种成因：原地打转的 UPDATE 恒 `changes = 0` /
 * 并发端抢写 / 降级期新写入的 legacy 行）→ `console.warn` 后返回（本进程
 * 停手、下个冷启动按谓词重扫，`sleep(0)` 续跑只会把空转放大成无界热循环）；
 * 预算耗尽 / 守卫暂停照旧零延迟续跑下一轮。
 *
 * 轮内抛错分流（cr-05）：「连接已关闭」→ warn 后 `continue`（下一轮重取
 * runtime 拿新连接，自然重挂）；其它归一真失败 → warn 后 return（本进程
 * 收手，下次启动幂等重试）。
 */
async function runDesktopBlobBinaryNormalization(): Promise<void> {
  for (;;) {
    if (isDesktopBusyForBlobBinary()) {
      await sleep(GUARD_RETRY_DELAY_MS);
      continue;
    }
    try {
      const runtime = await getDesktopRuntime();
      const result = await runBlobBinaryNormalization(runtime.conn, {
        // 批间再判一次守卫：避免单轮长时间独占 main 事件循环。
        shouldPause: isDesktopBusyForBlobBinary,
        // cr-03 + ic-01c：core 的收尾维护链路（GC/checkpoint/VACUUM）里
        // better-sqlite3 的 VACUUM 同步执行、冻结 main 事件循环——core 不
        // 感知 app 的 busy 状态，由这里借回调只包住真正会冻结的那一段置位
        // （与手动 runDbMaintenance 的纪律是同一条纪律的两处落点）；
        // afterMaintenance 为 finally 语义，VACUUM 抛错也复位。
        // 不自锁理由：shouldPause 的 busy 守卫只在批间检查，此时维护段尚未
        // 开始；before 置位发生在本轮批间检查之后、after 在 core 返回前已
        // 复位——下一轮守卫（含 shouldPause）读到的恒是 false。
        beforeMaintenance: () => setDesktopDbMaintenanceBusy(true),
        afterMaintenance: () => setDesktopDbMaintenanceBusy(false),
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        // 收尾谓词校验判定谓词内仍有非坏行残留（三种成因：原地打转的
        // UPDATE 恒 changes=0 / 并发端抢写 / 降级期新写入的 legacy 行）
        // → 本进程停手、下个冷启动按谓词重扫。
        console.warn(
          "[desktop] blob 形态归一收尾谓词校验仍有非坏行残留（打转/并发抢写/降级期新写入），本进程停手，下个冷启动按谓词重扫",
        );
        return;
      }
      // 预算耗尽/被守卫打断：让出事件循环立刻续跑下一轮。
      await sleep(0);
    } catch (err) {
      if (isConnectionClosedError(err)) {
        // 连接被 rebootstrap（备份导入/云同步 pull）换掉：不算失败收手，
        // 退避一拍让重建流程走完，下一轮重取 runtime 拿新连接自然重挂，
        // 远端库回灌后重新整理。
        console.warn(
          "[desktop] blob 形态归一轮内连接被关闭（疑似 rebootstrap），退避后换新连接重挂：",
          err instanceof Error ? err.message : err,
        );
        await sleep(RECONNECT_RETRY_DELAY_MS);
        continue;
      }
      console.warn(
        "[desktop] blob 形态归一失败，下次启动重试：",
        err instanceof Error ? err.message : err,
      );
      return;
    }
  }
}

/** 挂载标记：按 runtime 身份去重（cr-05 方案 A），同一 runtime 只挂一条循环。 */
let scheduledRuntime: DesktopNovelMasterRuntime | null = null;

/**
 * 启动后挂载存量 blob 形态归一（fire-and-forget，不阻塞启动）。
 *
 * 幂等：同一 runtime 重复调度不叠加循环；**连接被 rebootstrap 换掉时本
 * 任务视为可重挂**（去重键 = runtime 连接身份）——备份导入 / 云同步 pull
 * 回灌的远端库里若有未归一存量行，rebootstrap 完成后再次调度（或轮内
 * 自愈重挂）会重新整理，不必等下次冷启动（读路径 `decodeCompressedBytes`
 * 三形态兼容，存量行不归一也能读，无正确性影响；存储页状态行会如实显示
 * 「进行中（剩余 N 条）」）。
 */
export function scheduleDesktopBlobBinaryNormalization(): void {
  void (async () => {
    const runtime = await getDesktopRuntime();
    if (scheduledRuntime === runtime) {
      return;
    }
    scheduledRuntime = runtime;
    try {
      await runDesktopBlobBinaryNormalization();
    } finally {
      // 循环退出即清键：防「失败收手后身份键挂死」阻断后续重挂；done 正常
      // 收工后再调度也是幂等空转（core 首轮零成本短路）。
      if (scheduledRuntime === runtime) {
        scheduledRuntime = null;
      }
    }
  })();
}
