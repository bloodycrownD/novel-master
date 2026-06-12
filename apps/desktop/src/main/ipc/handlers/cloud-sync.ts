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
import { formatIpcError } from "../ipc-error.js";

export async function handleCloudSyncGetConfig(): Promise<
  IpcResult<CloudSyncConfigDto>
> {
  try {
    const service = await getDesktopCloudSyncService();
    const config = await service.getConfig();
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncSetConfig(
  req: CloudSyncSetConfigRequest,
): Promise<IpcResult<void>> {
  try {
    const service = await getDesktopCloudSyncService();
    await service.setConfig(req);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncTestConnection(): Promise<IpcResult<void>> {
  try {
    const service = await getDesktopCloudSyncService();
    await service.testConnection();
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncGetLocalStatus(): Promise<
  IpcResult<CloudSyncLocalStatusDto>
> {
  try {
    const service = await getDesktopCloudSyncService();
    const status = await service.getLocalStatus();
    return { ok: true, data: status };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncPull(): Promise<
  IpcResult<CloudSyncPullResult>
> {
  try {
    const service = await getDesktopCloudSyncService();
    const result = await service.pull();
    await rebootstrapDesktopRuntime();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCloudSyncPush(
  req?: CloudSyncPushRequest,
): Promise<IpcResult<CloudSyncPushResult>> {
  try {
    const service = await getDesktopCloudSyncService();
    const result = await service.push({
      forceOverwriteRemote: req?.forceOverwriteRemote,
    });
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
