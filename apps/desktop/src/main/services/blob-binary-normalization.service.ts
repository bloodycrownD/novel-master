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
 *   续跑；`stalled === true`（零进展护栏收手）→ `console.warn` 后**本进程
 *   停止重试**（`sleep(0)` 续跑只会把空转放大成无界热循环），下个冷启动
 *   再试；`done === true` → 收工返回。core 内部在全部完成时挂一次维护
 *   链路（带进程级去重，且 VACUUM 失败只 warn 不上抛），app 侧不直接调。
 * - **失败不上抛**：后台任务不参与启动成败判定，只 `console.warn`。归一
 *   任务本身可重入（谓词驱动，重启续跑），下个冷启动自然会再试。
 *
 * @module services/blob-binary-normalization
 */
import { runBlobBinaryNormalization } from "@novel-master/core";
import { getDesktopRuntime } from "../runtime/desktop-runtime-singleton.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopDbMaintenanceBusy } from "./db-maintenance-busy.js";
import { isDesktopCloudSyncBusy } from "./cloud-sync.service.js";

/** 守卫命中后的重试间隔（ms）：让 Agent 回合 / 云同步 / 清理有完整窗口。 */
const GUARD_RETRY_DELAY_MS = 5000;

/** 是否应让路：Agent 运行 / 云同步 / 数据清理任一进行中即为 true。 */
function isDesktopBusyForBlobBinary(): boolean {
  return (
    isDesktopAgentActive() ||
    isDesktopCloudSyncBusy() ||
    isDesktopDbMaintenanceBusy()
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
 * 三种收手口径：完成（`done = true`）返回；零进展护栏收手（`stalled =
 * true`）`console.warn` 后返回（本进程不再重试，`sleep(0)` 续跑只会把空转
 * 放大成无界热循环）；预算耗尽 / 守卫暂停照旧零延迟续跑下一轮。
 *
 * 导出供将来的手动触发使用；正常启动路径走
 * {@link scheduleDesktopBlobBinaryNormalization}。
 */
export async function runDesktopBlobBinaryNormalization(): Promise<void> {
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
      });
      if (result.done) {
        return;
      }
      if (result.stalled) {
        // 谓词反复命中同一批行、UPDATE 恒 changes=0：继续跑不会有任何进展，
        // 本进程收手、下个冷启动再试。
        console.warn(
          "[desktop] blob 形态归一零进展（疑似谓词原地打转），本进程停止重试，下次启动再试",
        );
        return;
      }
      // 预算耗尽/被守卫打断：让出事件循环立刻续跑下一轮。
      await sleep(0);
    } catch (err) {
      console.warn(
        "[desktop] blob 形态归一失败，下次启动重试：",
        err instanceof Error ? err.message : err,
      );
      return;
    }
  }
}

/** 挂载标记：保证同一进程内重复挂载不会叠加多个归一循环。 */
let scheduled = false;

/**
 * 启动后挂载存量 blob 形态归一（fire-and-forget，不阻塞启动）。
 *
 * 幂等：同一进程内重复调用只生效一次。**注意**备份导入后 rebootstrap 只调
 * `rebootstrapDesktopRuntime()`、不重入本函数——导入库中未归一的存量行推迟
 * 到下次冷启动处理（读路径 `decodeCompressedBytes` 三形态兼容，存量行不
 * 归一也能读，无正确性影响；存储页状态行会如实显示「进行中（剩余 N 条）」）。
 */
export function scheduleDesktopBlobBinaryNormalization(): void {
  if (scheduled) {
    return;
  }
  scheduled = true;
  void runDesktopBlobBinaryNormalization();
}
