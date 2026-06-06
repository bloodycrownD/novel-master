/**
 * App UI preference IPC — KKV module `nm-desktop-ui`.
 */
import type {
  AppUiGetRequest,
  AppUiGetResponse,
  AppUiSetRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import {
  createDesktopAppUiPreferences,
  DESKTOP_UI_KEY_THEME,
} from "../../storage/app-ui-prefs.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

export async function handleAppUiGet(
  req: AppUiGetRequest,
): Promise<AppUiGetResponse> {
  try {
    const rt = await getDesktopRuntime();
    const appUi = createDesktopAppUiPreferences(rt.kkv);
    const value = await appUi.get(req.key);
    return { ok: true, data: value };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleAppUiSet(
  req: AppUiSetRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const appUi = createDesktopAppUiPreferences(rt.kkv);
    if (req.key === DESKTOP_UI_KEY_THEME && req.value !== "light" && req.value !== "dark") {
      return {
        ok: false,
        error: { code: "INVALID_ARGUMENT", message: "theme must be light or dark" },
      };
    }
    await appUi.set(req.key, req.value);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
