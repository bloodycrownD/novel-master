/**
 * 云同步 IPC 处理器：配置、测试连接、Pull/Push。
 */
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
import { getDesktopCloudSyncService } from "../../services/cloud-sync.service.js";
import { DatabaseReplacedError } from "../../services/db-backup.service.js";
import {
  acquireDesktopDbMaintenanceBusy,
  releaseDesktopDbMaintenanceBusy,
} from "../../services/db-maintenance-busy.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr, toIpcResult } from "../ipc-result.js";
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
    const serviceR = await getDesktopCloudSyncService();
    if (!serviceR.ok) return ipcErr(formatIpcError(serviceR.error));
    const service = serviceR.value;
    const pulled = await service.pull();
    // 已知失败沿 Result 到达；coordinator 侧故障仍走下方 catch。
    if (!pulled.ok) return ipcErr(formatIpcError(pulled.error));
    const result = pulled.value;
    if (result.databaseReplaced) {
      // 重建的已知失败沿 Result 到达（错误通道迁移七期），就地转码。
      const rebuilt = await rebootstrapDesktopRuntime();
      if (!rebuilt.ok) return ipcErr(formatIpcError(rebuilt.error));
      // 记账必须用重建后的 runtime：service 实例是 rebootstrap 之前捕获的旧代，
      // 它自带的 configStore 背后的连接已被换库关掉。
      await service.recordPullSuccess(result.rev);
    }
    return { ok: true, data: result };
  } catch (err) {
    // 库已换代但后续步骤抛错：runtime 换代优先于报错——「库已换却不重建」
    // 比「记账失败」更糟（后续请求继续绑在已关连接上）。
    if (err instanceof DatabaseReplacedError) {
      const rebuilt = await rebootstrapDesktopRuntime();
      if (!rebuilt.ok) return { ok: false, error: formatIpcError(rebuilt.error) };
      // ⚠️ 这段文案是**给用户看的 toast**（CR cloudsync P2-2）：不要把
      // `providerTablesRestored` 这类 TypeScript 字段名拼进去——它对用户零信息量，
      // 只会让人对着一个内部布尔名发懵。要判断成没成，看这里的中文措辞即可；
      // 字段值本身只进日志。
      log.warn("库已换代但服务商配置表未完全恢复", { providerTablesRestored: err.providerTablesRestored });
      return { ok: false, error: formatIpcError(new Error(`${err.message}（服务商配置未能恢复，请检查模型服务商设置）`)) };
    }
    return { ok: false, error: formatIpcError(err) };
  } finally {
    releaseDesktopDbMaintenanceBusy();
  }
}

export async function handleCloudSyncPush(req?: CloudSyncPushRequest): Promise<IpcResult<CloudSyncPushResult>> {
  try {
    const serviceR = await getDesktopCloudSyncService();
    if (!serviceR.ok) return ipcErr(formatIpcError(serviceR.error));
    const service = serviceR.value;
    const pushed = await service.push({ forceOverwriteRemote: req?.forceOverwriteRemote });
    if (!pushed.ok) return ipcErr(formatIpcError(pushed.error));
    return { ok: true, data: pushed.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
