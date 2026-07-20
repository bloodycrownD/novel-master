/**
 * 事件配置 IPC：读写与清空（不依赖 Electron 对话框，便于 Node 单测）。
 */
import type {
  EventsGetConfigResponse,
  EventsSetConfigRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";
import { toStoredConfigHealthDto } from "./stored-config-health-dto.js";

/** 读取事件配置：main 侧 assess，返回 StoredConfigHealthDto。 */
export async function handleEventsGetConfig(): Promise<
  IpcResult<EventsGetConfigResponse>
> {
  try {
    const rt = await getDesktopRuntime();
    const health = await rt.eventsConfig.assessStored();
    return { ok: true, data: toStoredConfigHealthDto(health) };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleEventsSetConfig(
  req: EventsSetConfigRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.eventsConfig.setConfig(
      req.config as Parameters<typeof rt.eventsConfig.setConfig>[0],
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleEventsClearConfig(): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.eventsConfig.clearConfig();
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
