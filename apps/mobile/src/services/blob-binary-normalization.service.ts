/**
 * 存量 blob 行形态归一（base64 文本 → 二进制 BLOB）mobile 调度服务。
 *
 * 归一本体在 core `runBlobBinaryNormalization`（谓词驱动、分批、每表
 * KKV 完成标记、幂等可重入）；本服务只做 app 层的三件事——把各端守卫
 * 组合成 core 的 `shouldPause`、把「一轮预算跑不完」续成循环、并在
 * 失败时静默收手（靠下次启动幂等重试，不打断用户）。
 *
 * 守卫组合（app 层职责，core 不感知端形态）：
 * - `isMobileAgentActive()`：Agent 回合正在跑时暂停归一——归一会逐行
 *   短事务写库，与 Agent 的读写同抢 op-sqlite 连接，插队会让首 token
 *   延迟明显。与既有 `db-maintenance.service` / `db-backup.service`
 *   的 Agent 门禁同源。
 * - `isMobileDbMaintenanceBusy()`（数据清理/备份/云同步互斥）：数据
 *   清理 VACUUM / 备份导入「关连接 + 覆盖库文件」/ 云同步快照替换期间
 *   逐行短事务让路，与消息压缩循环同一守卫口径。
 *
 * 收尾不调 `runStartupMaintenanceOnce`：core 内部的收尾维护仅在本轮
 * 确有推进（成功改写 ≥1 行）且全部表完成时触发一次，稳态零成本，app
 * 侧再调会重复；上一轮维护失败会由持久化标记（`startupMaintenancePending`）
 * 补跑。
 *
 * 三种 `done = false` 的收手口径：完成（`done = true`）直接收工；
 * `stalled = true` 表示收尾谓词校验判定谓词内仍有非坏行残留（三种成因：
 * 原地打转的 UPDATE 恒 `changes = 0` / 并发端抢写 / 降级期新写入的 legacy
 * 行）→ 本进程停手、下个冷启动按谓词重扫（`sleep(0)` 续跑只会把空转放大
 * 成无界热循环）；预算耗尽 / 守卫暂停照旧零延迟续跑。
 *
 * @module services/blob-binary-normalization.service
 */
import {runBlobBinaryNormalization, type BlobBinaryRunResult} from '@novel-master/core';
import {isMobileAgentActive} from '../runtime/agent-activity';
import {isMobileDbMaintenanceBusy} from './db-maintenance-busy';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** 起步让路：等首屏渲染与 runtime 水合跑完再抢库。 */
const WARMUP_DELAY_MS = 3000;
/** 守卫命中后的重试间隔（不算进 core 的单轮同步预算，纯等待）。 */
const GUARD_RETRY_DELAY_MS = 5000;

/** 已挂载的 runtime（按连接身份去重，保证重复调用不叠加循环）。 */
let scheduledRuntime: MobileNovelMasterRuntime | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/** 归一循环的让路守卫：Agent 活跃或维护/备份/云同步 busy 任一命中。 */
function mobileNormalizationBlocked(): boolean {
  return isMobileAgentActive() || isMobileDbMaintenanceBusy();
}

/**
 * 归一循环：热身让路 → 逐轮调 core（单轮内自带 60s 同步预算）→
 * 守卫命中则退避重试（不消耗预算）、未跑完则零延迟续跑、全部完成即收手。
 *
 * 任何一轮抛错都只 `console.error` 后 return：归一是幂等的纯优化，
 * 下一轮 app 启动会按谓词续扫，用户无感知；上抛反而会污染启动链路。
 * `stalled = true` 表示收尾谓词校验判定谓词内仍有非坏行残留（三种成因：
 * 原地打转的 UPDATE 恒 `changes = 0` / 并发端抢写 / 降级期新写入的 legacy
 * 行）→ `console.warn` 后返回（本进程停手、下个冷启动按谓词重扫，`sleep(0)`
 * 续跑只会把空转放大成无界热循环）。
 */
async function runNormalizationLoop(
  runtime: MobileNovelMasterRuntime,
): Promise<void> {
  await sleep(WARMUP_DELAY_MS);
  for (;;) {
    if (mobileNormalizationBlocked()) {
      await sleep(GUARD_RETRY_DELAY_MS);
      continue;
    }
    let result: BlobBinaryRunResult;
    try {
      // 守卫在 core 批间再查一次（长批次内部 Agent 可能起跑），
      // 命中即返回 done=false，本层零延迟续跑下一轮。
      result = await runBlobBinaryNormalization(runtime.conn, {
        shouldPause: mobileNormalizationBlocked,
      });
    } catch (err) {
      console.error('[blob-binary] 归一循环中止', err);
      return;
    }
    if (result.done) {
      return;
    }
    if (result.stalled) {
      // 收尾谓词校验判定谓词内仍有非坏行残留（三种成因：原地打转的
      // UPDATE 恒 changes=0 / 并发端抢写 / 降级期新写入的 legacy 行）
      // → 本进程停手、下个冷启动按谓词重扫。
      console.warn(
        '[blob-binary] 归一收尾谓词校验仍有非坏行残留（打转/并发抢写/降级期新写入），本进程停手，下个冷启动按谓词重扫',
      );
      return;
    }
    await sleep(0);
  }
}

/**
 * 挂载归一循环（幂等）：同一 runtime 重复调用不叠加第二条循环。
 *
 * 调用点：runtime 就绪后的既有 effect（`novel-master-context.tsx`）。
 * 注意 **retry 换新 runtime 时需对新连接重挂一次**——挂载表按 runtime
 * 实例去重，新 runtime 是新键，本函数会正常起一条新循环；旧 runtime 的
 * 循环随连接关闭自然落空（写库抛错后 console.error 收手）。
 */
export function scheduleMobileBlobBinaryNormalization(
  runtime: MobileNovelMasterRuntime,
): void {
  if (scheduledRuntime === runtime) {
    return;
  }
  scheduledRuntime = runtime;
  void runNormalizationLoop(runtime);
}
