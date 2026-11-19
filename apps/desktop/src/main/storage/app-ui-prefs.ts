/**
 * Desktop UI preferences backed by KKV module `nm-desktop-ui`.
 *
 * @module storage/app-ui-prefs
 */
import { AppErrorOps, type AppError } from "@novel-master/core/errors";
import { Result } from "@novel-master/core/errors";
import type { KkvService } from "@novel-master/core/kkv";

const DESKTOP_UI_KKV_MODULE = "nm-desktop-ui";

export const DESKTOP_UI_KEY_THEME = "theme";
const DESKTOP_UI_KEY_CHAT_RICH_TEXT = "chatRichText";

/** Update-check preferences (Client UI layer — not nm-preferences). */
const DESKTOP_UI_KEY_UPDATES_AUTO_CHECK = "updates.autoCheck";
/** ISO-8601 — suppress auto-check result modal until this instant. */
export const DESKTOP_UI_KEY_UPDATES_SNOOZE_UNTIL = "updates.snoozeUntil";

const DESKTOP_UI_DEFAULTS: Record<string, string> = {
  [DESKTOP_UI_KEY_THEME]: "light",
  [DESKTOP_UI_KEY_CHAT_RICH_TEXT]: "false",
  [DESKTOP_UI_KEY_UPDATES_AUTO_CHECK]: "true",
};

interface DesktopAppUiPreferences {
  get(key: string): Promise<Result<string | undefined, AppError>>;
  set(key: string, value: string): Promise<void>;
}

export function createDesktopAppUiPreferences(kkv: KkvService): DesktopAppUiPreferences {
  return {
    async get(key: string): Promise<Result<string | undefined, AppError>> {
      const raw = await kkv.get(DESKTOP_UI_KKV_MODULE, key);
      if (!raw.ok) {
        if (AppErrorOps.is(raw.error, "KKV_NOT_FOUND")) {
          return Result.ok(key in DESKTOP_UI_DEFAULTS ? DESKTOP_UI_DEFAULTS[key] : undefined);
        }
        return raw;
      }
      return raw;
    },
    async set(key: string, value: string) {
      await kkv.set(DESKTOP_UI_KKV_MODULE, key, value);
    },
  };
}
