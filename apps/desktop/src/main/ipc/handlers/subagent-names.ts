/**
 * Subagent 名单 IPC — 全局子智能体名单的读写。
 *
 * @module ipc/handlers/subagent-names
 */
import type {
  IpcResult,
  SubagentNamesSetRequest,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";

export async function handleSubagentNamesGet(): Promise<IpcResult<string[]>> {
  try {
    const rt = await getDesktopRuntime();
    const names = await rt.state.getSubagentNames();
    return { ok: true, data: [...names] };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleSubagentNamesSet(
  req: SubagentNamesSetRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.state.setSubagentNames(req.names);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
