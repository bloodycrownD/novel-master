/**
 * 云同步 IPC 处理器：配置、测试连接、Pull/Push。
 */
import { ABORT_KEY, type AbortScope } from "@novel-master/core/abort";
import { AppError, type Outcome } from "@novel-master/core/errors";
import type {
  CloudSyncConfigDto,
  CloudSyncLocalStatusDto,
  CloudSyncPullResult,
  CloudSyncPushRequest,
  CloudSyncPushResult,
  CloudSyncSetConfigRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { rebootstrapDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { getDesktopCloudSyncService } from "../../services/cloud-sync.service.js";
import { DatabaseReplacedError } from "../../services/db-backup.service.js";
import {
  acquireDesktopDbMaintenanceBusy,
  releaseDesktopDbMaintenanceBusy,
} from "../../services/db-maintenance-busy.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr, toIpcResult } from "../ipc-result.js";
import { outcomeIfAborted, runAbortable } from "../run-scope.js";
import { createLogger } from "@novel-master/core/log";

const log = createLogger("desktop.ipc.cloud-sync");

export async function handleCloudSyncGetConfig(): Promise<
  IpcResult<CloudSyncConfigDto>
> {
  try {
    const serviceR = await getDesktopCloudSyncService();
    // runtime 装配的已知失败沿 Result 到达（错误通道迁移七期），就地转码。
    if (!serviceR.ok) return ipcErr(formatIpcError(serviceR.error));
    const service = serviceR.value;
    return toIpcResult(await service.getConfig());
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncSetConfig(req: CloudSyncSetConfigRequest): Promise<IpcResult<void>> {
  try {
    const serviceR = await getDesktopCloudSyncService();
    if (!serviceR.ok) return ipcErr(formatIpcError(serviceR.error));
    const service = serviceR.value;
    const r = await service.setConfig(req);
    if (!r.ok) return ipcErr(formatIpcError(r.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncSetEnabled(enabled: boolean): Promise<IpcResult<void>> {
  try {
    const serviceR = await getDesktopCloudSyncService();
    if (!serviceR.ok) return ipcErr(formatIpcError(serviceR.error));
    const service = serviceR.value;
    await service.setEnabled(enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncTestConnection(): Promise<IpcResult<void>> {
  try {
    const serviceR = await getDesktopCloudSyncService();
    if (!serviceR.ok) return ipcErr(formatIpcError(serviceR.error));
    const service = serviceR.value;
    const r = await service.testConnection();
    if (!r.ok) return ipcErr(formatIpcError(r.error));
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncGetLocalStatus(): Promise<
  IpcResult<CloudSyncLocalStatusDto>
> {
  try {
    const serviceR = await getDesktopCloudSyncService();
    if (!serviceR.ok) return ipcErr(formatIpcError(serviceR.error));
    const service = serviceR.value;
    const status = await service.getLocalStatus();
    if (!status.ok) return ipcErr(formatIpcError(status.error));
    return { ok: true, data: status.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

/**
 * 云同步 pull（signal-abort-scope §五）：key 固定 `sync:local`（S3 配置无
 * provider 概念，`syncBusy` 全局互斥），不设 timeout，**禁止 race**。
 *
 * 取消只落在入口与换库前的阶段边界；`replaceLiveDatabase` 与紧随其后的
 * rebootstrap/记账属于不可中断窗口——库已换代却提前 settle 会让 runtime
 * 继续绑在已关闭的连接上，比「取消不生效」危险得多。
 */
export async function handleCloudSyncPull(): Promise<
  IpcResult<CloudSyncPullResult>
> {
  // ic-20 外层令牌：busy 为计数/令牌配对——底层快照搬运函数已
  // acquire/release 自平衡；pull 会整库替换并 rebootstrap，这里再持一枚
  // 覆盖「库文件已替换、rebootstrap 尚未完成」的重建窗口，release 严格在
  // rebootstrap + 记账完成之后（finally 兜底失败路径）。push 无 rebootstrap，
  // 由底层令牌覆盖即可，不加外层。
  //
  // 契约顺序：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
  // 判定口径是「库文件真的换了吗」（databaseReplaced，来自 import 函数的
  // 返回值／异常这一物理事实），**不是**「pull 抛错了吗」——后者会被
  // ALREADY_UP_TO_DATE 早返回路径污染，且会让「已是最新」白付一次全量重建。
  acquireDesktopDbMaintenanceBusy();
  try {
    const built = await getDesktopRuntime();
    if (!built.ok) return ipcErr(formatIpcError(built.error));
    const rt = built.value;
    // exclusive：pull/push 共用固定 key，第二个请求必须在不覆盖在途 scope 的前提下
    // 被拒（register 覆盖会让在途任务的取消入口静默消失，见 T-S15 的 key 语义）。
    return await runAbortable(
      { registry: rt.abortRegistry, key: ABORT_KEY.cloudSync("local"), exclusive: true, conflictError: new AppError("CLI_INVALID_ARGUMENT", { detail: "云同步进行中，请稍后再试" }) },
      (scope) => doCloudSyncPull(scope)
    );
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}

/** 可中断的 pull 段：入口检查点 + 未换代时的阶段边界检查点。 */
export async function doCloudSyncPull(scope: AbortScope): Promise<Outcome<CloudSyncPullResult>> {
  const stopped = outcomeIfAborted(scope);
  if (stopped != null) return stopped;
  try {
    const serviceR = await getDesktopCloudSyncService();
    if (!serviceR.ok) return { kind: "failed", error: serviceR.error };
    const service = serviceR.value;
    // 阶段边界 checkpoint 由 core coordinator 在 pull:downloaded / pull:before-import 调用；
    // 换库窗口之前命中即抛 AbortError，原样经 runAbortable 收成 IPC_ABORTED。
    const pulled = await service.pull({ checkpoint: () => scope.checkpoint() });
    // 已知失败沿 Result 到达；coordinator 侧故障仍走下方 catch。
    if (!pulled.ok) return { kind: "failed", error: pulled.error };
    const result = pulled.value;
    if (result.databaseReplaced) {
      // 换库窗口不可中断：rebootstrap/记账无条件跑完（见上方注释）。
      const rebuilt = await rebootstrapDesktopRuntime();
      if (!rebuilt.ok) return { kind: "failed", error: rebuilt.error };
      // 记账必须用重建后的 runtime：service 实例是 rebootstrap 之前捕获的旧代，
      // 它自带的 configStore 背后的连接已被换库关掉。
      await service.recordPullSuccess(result.rev);
    } else {
      const interrupted = outcomeIfAborted(scope);
      if (interrupted != null) return interrupted;
    }
    return { kind: "completed", value: result };
  } catch (err) {
    // 库已换代但后续步骤抛错：runtime 换代优先于报错——「库已换却不重建」
    // 比「记账失败」更糟（后续请求继续绑在已关连接上）。
    if (err instanceof DatabaseReplacedError) {
      const rebuilt = await rebootstrapDesktopRuntime();
      if (!rebuilt.ok) return { kind: "failed", error: rebuilt.error };
      // ⚠️ 这段文案是**给用户看的 toast**（CR cloudsync P2-2）：不要把
      // `providerTablesRestored` 这类 TypeScript 字段名拼进去——它对用户零信息量，
      // 只会让人对着一个内部布尔名发懵。要判断成没成，看这里的中文措辞即可；
      // 字段值本身只进日志。
      log.warn("库已换代但服务商配置表未完全恢复", { providerTablesRestored: err.providerTablesRestored });
      // 补偿链的「已换代 + 三表未恢复」不是业务失败通道能表达的状态，保留既有
      // 未知通道抛错，由 runAbortable 的边界统一 formatIpcError。
      // nm-throw: keep — 库已换代但服务商配置表未恢复属故障态不变量，Outcome 的 failed 表达不了「库已变但重建未完成」。
      throw new Error(`${err.message}（服务商配置未能恢复，请检查模型服务商设置）`);
    }
    throw err;
  }
}

/**
 * 云同步 push：同 key、不设 timeout、**禁止 race**（临时文件清理与底层流程
 * 同生命周期）。入口检查点之后进入快照导出 → 上传的连续段。
 */
export async function handleCloudSyncPush(req?: CloudSyncPushRequest): Promise<IpcResult<CloudSyncPushResult>> {
  const built = await getDesktopRuntime();
  if (!built.ok) return ipcErr(formatIpcError(built.error));
  const rt = built.value;
  return runAbortable(
    { registry: rt.abortRegistry, key: ABORT_KEY.cloudSync("local"), exclusive: true, conflictError: new AppError("CLI_INVALID_ARGUMENT", { detail: "云同步进行中，请稍后再试" }) },
    (scope) => doCloudSyncPush(req, scope)
  );
}

/** 可中断的 push 段：仅入口检查点（上传完成即自然终态，不把已推送翻成取消）。 */
export async function doCloudSyncPush(req: CloudSyncPushRequest | undefined, scope: AbortScope): Promise<Outcome<CloudSyncPushResult>> {
  const stopped = outcomeIfAborted(scope);
  if (stopped != null) return stopped;
  const serviceR = await getDesktopCloudSyncService();
  if (!serviceR.ok) return { kind: "failed", error: serviceR.error };
  // push:exported / push:before-upload 阶段边界由 core coordinator 判停。
  const pushed = await serviceR.value.push({ forceOverwriteRemote: req?.forceOverwriteRemote, checkpoint: () => scope.checkpoint() });
  return pushed.ok ? { kind: "completed", value: pushed.value } : { kind: "failed", error: pushed.error };
}
