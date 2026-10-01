/**
 * VFS 非 head 历史版本混合打包（zlib-concat / fossil 链）mobile 调度服务。
 *
 * 打包本体在 core `runVfsContentPacking`（候选谓词驱动、每组单事务、
 * 单轮同步预算、无终态完成标记）；本服务只做 app 层的三件事——把各端
 * 守卫组合成 core 的 `shouldPause`、把「一轮预算跑不完」续成循环、并在
 * 失败时静默收手（靠下次启动幂等重试，不打断用户）。骨架与调度口径
 * 照 `blob-binary-normalization.service` 同款。
 *
 * 守卫组合（app 层职责，core 不感知端形态）：
 * - `isMobileAgentActive()`：Agent 回合正在跑时暂停打包——打包会逐组
 *   短事务写库 + 组间读明文，与 Agent 的读写同抢 op-sqlite 连接，插队
 *   会让首 token 延迟明显。与既有 `db-maintenance.service` /
 *   `db-backup.service` 的 Agent 门禁同源。
 * - `isMobileDbMaintenanceBusy()`（数据清理/备份/云同步互斥）：数据清理
 *   VACUUM / 备份导入「关连接 + 覆盖库文件」/ 云同步快照替换期间逐组
 *   短事务让路，与归一循环同一守卫口径。
 *
 * 与 blob 归一循环的分叉（core 语义差异在 app 侧的投影）：
 * - **无终态**：`done = true` 只表示「本轮跑完收尾校验且无打转」，新写入
 *   的历史版本会持续攒出新候选组——本进程照样收工（常驻轮询重扫候选
 *   谓词的收益不抵 IO），新组由下次冷启动 / retry 重挂的循环收敛。
 * - 收尾不调 `runStartupMaintenanceOnce`：core 内部的收尾维护仅在本轮
 *   确有打包（`packedGroups > 0`）或读到 pending 兜底标记时触发一次，
 *   稳态零成本；上一轮维护失败会由持久化标记补跑。
 * - `stalled = true`（剩余候选 > 坏组数，打转/并发抢写信号）→ 本进程
 *   停手、下个冷启动按谓词重扫（`sleep(0)` 续跑只会把空转放大成无界
 *   热循环）；预算耗尽 / 守卫暂停照旧零延迟续跑。
 *
 * 调度登记键：只在循环存活期间去重（同 runtime 重挂不叠加循环），循环
 * 收手后释放——同一 runtime 再调度会重挂一条新循环（打包循环常态就是
 * done=true 收工，若收手不释放键，后续任何再调度会被静默 no-op 吞掉）。
 *
 * @module services/vfs-content-packing.service
 */
import {runVfsContentPacking, type VfsContentPackRunResult} from '@novel-master/core';
import {isMobileAgentActive} from '../runtime/agent-activity';
import {isMobileDbMaintenanceBusy} from './db-maintenance-busy';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** 起步让路：等首屏渲染与 runtime 水合跑完再抢库。 */
const WARMUP_DELAY_MS = 3000;
/** 守卫命中后的重试间隔（不算进 core 的单轮同步预算，纯等待）。 */
const GUARD_RETRY_DELAY_MS = 5000;

/**
 * 已挂载的 runtime（按连接身份去重，保证重复调用不叠加循环）。
 *
 * 登记键**只在循环存活期间**去重：循环收手（含 done 收工 / stalled 停手 /
 * 抛错收手）后 finally 条件复位释放，同一 runtime 再调度是合法重挂——去重
 * 挡的是「运行中」的重复挂载，不是「曾经跑过」。
 */
let scheduledRuntime: MobileNovelMasterRuntime | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/** 打包循环的让路守卫：Agent 活跃或维护/备份/云同步 busy 任一命中。 */
function mobilePackingBlocked(): boolean {
  return isMobileAgentActive() || isMobileDbMaintenanceBusy();
}

/**
 * 打包循环：热身让路 → 逐轮调 core（单轮内自带 30s 同步预算）→
 * 守卫命中则退避重试（不消耗预算）、未跑完则零延迟续跑、本轮收敛即收手。
 *
 * 任何一轮抛错都只 `console.error` 后 return：打包是幂等的纯优化，下一轮
 * app 启动会按谓词续扫（已落库的 pack 永不重写），用户无感知；上抛反而
 * 会污染启动链路。
 */
async function runPackingLoop(
  runtime: MobileNovelMasterRuntime,
): Promise<void> {
  await sleep(WARMUP_DELAY_MS);
  for (;;) {
    if (mobilePackingBlocked()) {
      await sleep(GUARD_RETRY_DELAY_MS);
      continue;
    }
    let result: VfsContentPackRunResult;
    try {
      // 守卫在 core 组间再查一次（长组内部 Agent 可能起跑），命中即返回
      // done=false，本层零延迟续跑下一轮。
      result = await runVfsContentPacking(runtime.conn, {
        shouldPause: mobilePackingBlocked,
      });
    } catch (err) {
      console.error('[vfs-content-packing] 打包循环中止', err);
      return;
    }
    if (result.done) {
      // 本轮收敛（剩余候选只剩坏组或已清空）；新版本攒的新组由下次
      // 启动 / retry 重挂的循环收敛，本进程不常驻轮询。
      return;
    }
    if (result.stalled) {
      // 收尾校验判定剩余候选 entry 数 > failedGroups（打转或并发抢写）
      // → 本进程停手、下个冷启动按谓词重扫。
      console.warn(
        '[vfs-content-packing] 收尾校验发现候选未收敛（打转/并发抢写），本进程停手，下个冷启动按谓词重扫',
      );
      return;
    }
    await sleep(0);
  }
}

/**
 * 挂载打包循环（幂等）：同一 runtime 在**循环存活期间**重复调用不叠加第二
 * 条循环；循环收手后 finally 释放登记键，同一 runtime 再调度会重挂。
 *
 * 调用点：runtime 就绪后的既有 effect（`novel-master-context.tsx`）。
 * 注意 **retry 换新 runtime 时需对新连接重挂一次**——挂载表按 runtime
 * 实例去重，新 runtime 是新键，本函数会正常起一条新循环；旧 runtime 的
 * 循环随连接关闭自然落空（写库抛错后 console.error 收手）。
 */
export function scheduleMobileVfsContentPacking(
  runtime: MobileNovelMasterRuntime,
): void {
  if (scheduledRuntime === runtime) {
    return;
  }
  scheduledRuntime = runtime;
  void runPackingLoop(runtime).finally(() => {
    // 循环收手后释放登记键（条件复位：期间若已换新 runtime 重挂，键属新
    // runtime，不得抹掉）。
    if (scheduledRuntime === runtime) {
      scheduledRuntime = undefined;
    }
  });
}
