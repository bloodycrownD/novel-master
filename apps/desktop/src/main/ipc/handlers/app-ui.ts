/**
 * App UI preference IPC — KKV module `nm-desktop-ui`.
 */
import type {
  AppUiGetRequest,
  AppUiGetResponse,
  AppUiSetRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { AppUiPrefs, DESKTOP_UI_KEY_THEME } from "../../storage/app-ui-prefs.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { FormatIpcError } from "../format-ipc-error.js";

export const AppUi = {
  async get(req: AppUiGetRequest): Promise<AppUiGetResponse> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const appUi = AppUiPrefs.create(rt.kkv);
      const raw = await appUi.get(req.key);
      if (!raw.ok) return { ok: false, error: FormatIpcError.format(raw.error) };
      return { ok: true, data: raw.value };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },

  async set(req: AppUiSetRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const appUi = AppUiPrefs.create(rt.kkv);
      if (req.key === DESKTOP_UI_KEY_THEME && req.value !== "light" && req.value !== "dark") {
        return {
          ok: false,
          error: { code: "IPC_INVALID_ARGUMENT", message: "theme must be light or dark" },
        };
      }
      await appUi.set(req.key, req.value);
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  },
} as const;
