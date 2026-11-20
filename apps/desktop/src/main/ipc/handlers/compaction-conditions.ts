/**
 * Compaction conditions IPC handlers.
 */
import type {
  CompactionConditionsDto,
  CompactionConditionsSetRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { FormatIpcError } from "../format-ipc-error.js";
import { IpcResults } from "../ipc-result.js";

export const CompactionConditions = {
  async get(): Promise<IpcResult<CompactionConditionsDto | null>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const conditions = await rt.compactionConditions.getConditions();
      if (!conditions.ok) return IpcResults.err(FormatIpcError.format(conditions.error));
      return { ok: true, data: conditions.value as CompactionConditionsDto | null };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },

  async set(req: CompactionConditionsSetRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      await rt.compactionConditions.setConditions(req.conditions as Parameters<typeof rt.compactionConditions.setConditions>[0]);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },
} as const;
