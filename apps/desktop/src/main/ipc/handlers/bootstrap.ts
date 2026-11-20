/**
 * Bootstrap IPC handlers — renderer probes main-process runtime readiness.
 */
import type {
  BootstrapRebootstrapResponse,
  BootstrapStatusResponse,
} from "../../../../shared/ipc-types.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { FormatIpcError } from "../format-ipc-error.js";

export const Bootstrap = {
  async status(): Promise<BootstrapStatusResponse> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // 装配的已知失败沿 Result 到达（错误通道迁移七期），就地转码；未知异常仍走 catch。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      return { ok: true, status: "ready", dbPath: built.value.dbPath };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },

  async rebootstrap(): Promise<BootstrapRebootstrapResponse> {
    try {
      const rebuilt = await DesktopRuntimeSingleton.rebootstrap();
      if (!rebuilt.ok) return { ok: false, error: FormatIpcError.format(rebuilt.error) };
      return { ok: true, status: "ready", dbPath: rebuilt.value.dbPath };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },
} as const;
