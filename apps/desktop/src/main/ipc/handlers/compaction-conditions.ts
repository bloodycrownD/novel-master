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

export async function handleCompactionConditionsGet(): Promise<
  IpcResult<CompactionConditionsDto | null>
> {
  try {
    const rt = await getDesktopRuntime();
    const conditions = await rt.compactionConditions.getConditions();
    return { ok: true, data: conditions as CompactionConditionsDto | null };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleCompactionConditionsSet(
  req: CompactionConditionsSetRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
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
