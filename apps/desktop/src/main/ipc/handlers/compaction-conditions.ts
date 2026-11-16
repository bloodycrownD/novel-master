/**
 * Compaction conditions IPC handlers.
 */
import type {
  CompactionConditionsDto,
  CompactionConditionsSetRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr } from "../ipc-result.js";

export async function handleCompactionConditionsGet(): Promise<
  IpcResult<CompactionConditionsDto | null>
> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const conditions = await rt.compactionConditions.getConditions();
    if (!conditions.ok) return ipcErr(formatIpcError(conditions.error));
    return { ok: true, data: conditions.value as CompactionConditionsDto | null };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCompactionConditionsSet(
  req: CompactionConditionsSetRequest,
): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    await rt.compactionConditions.setConditions(
      req.conditions as Parameters<
        typeof rt.compactionConditions.setConditions
      >[0],
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
