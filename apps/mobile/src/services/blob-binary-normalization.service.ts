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
 * - 本仓 main 上 mobile 侧**没有**维护/备份/云同步的 busy 互斥标志
 *   （desktop 侧才有 `isDesktopCloudSyncBusy` + `db-maintenance-busy`），
 *   故这里只挂 Agent 守卫一条。将来 mobile 补上 busy 标志时，在
 *   `shouldPause` 里追加一个 `||` 即可，循环形态不用动。
 *
 * 收尾不调 `runStartupMaintenanceOnce`：core 内部在全部注册表归一完成
 * 时已自挂一次进程级去重的维护链路，app 侧再调会重复。
 *
 * 三种 `done = false` 的收手口径：完成（`done = true`）直接收工；零进展护栏
 * 收手（`stalled = true`）本进程不再重试（`sleep(0)` 续跑只会把空转放大成
 * 无界热循环），下个冷启动再试；预算耗尽 / 守卫暂停照旧零延迟续跑。
 *
 * @module services/blob-binary-normalization.service
 */
import {runBlobBinaryNormalization, type BlobBinaryRunResult} from '@novel-master/core';
import {isMobileAgentActive} from '../runtime/agent-activity';
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

/**
 * 归一循环：热身让路 → 逐轮调 core（单轮内自带 60s 同步预算）→
 * 守卫命中则退避重试（不消耗预算）、未跑完则零延迟续跑、全部完成即收手。
 *
 * 任何一轮抛错都只 `console.error` 后 return：归一是幂等的纯优化，
 * 下一轮 app 启动会按谓词续扫，用户无感知；上抛反而会污染启动链路。
 * `stalled = true`（零进展护栏收手）同样直接 return：本进程不再重试。
 */
async function runNormalizationLoop(
  runtime: MobileNovelMasterRuntime,
): Promise<void> {
  await sleep(WARMUP_DELAY_MS);
  for (;;) {
    if (isMobileAgentActive()) {
      await sleep(GUARD_RETRY_DELAY_MS);
      continue;
    }
    let result: BlobBinaryRunResult;
    try {
      // 守卫在 core 批间再查一次（长批次内部 Agent 可能起跑），
      // 命中即返回 done=false，本层零延迟续跑下一轮。
      result = await runBlobBinaryNormalization(runtime.conn, {
        shouldPause: () => isMobileAgentActive(),
      });
    } catch (err) {
      console.error('[blob-binary] 归一循环中止', err);
      return;
    }
    if (result.done) {
      return;
    }
    if (result.stalled) {
      // 零进展护栏收手：谓词反复命中同一批行、UPDATE 恒 changes=0，
      // 立刻续跑也不会有任何进展。这里必须收手（本进程不再重试、下个冷
      // 启动再试），否则 sleep(0) 的「立即续跑」会把空转放大成无界热循环。
      console.warn(
        '[blob-binary] 归一零进展（疑似谓词原地打转），本进程停止重试，下次启动再试',
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
