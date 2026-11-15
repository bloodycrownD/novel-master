/**
 * Desktop UI preferences backed by KKV module `nm-desktop-ui`.
 *
 * @module storage/app-ui-prefs
 */
import { isAppError, type AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import type { KkvService } from "@novel-master/core/kkv";

export const DESKTOP_UI_KKV_MODULE = "nm-desktop-ui";

export const DESKTOP_UI_KEY_THEME = "theme";
export const DESKTOP_UI_KEY_CHAT_RICH_TEXT = "chatRichText";

/** Update-check preferences (Client UI layer — not nm-preferences). */
export const DESKTOP_UI_KEY_UPDATES_AUTO_CHECK = "updates.autoCheck";
export const DESKTOP_UI_KEY_UPDATES_LAST_CHECK_AT = "updates.lastCheckAt";
export const DESKTOP_UI_KEY_UPDATES_LAST_CHECK_STATUS = "updates.lastCheckStatus";
export const DESKTOP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION =
  "updates.lastCheckRemoteVersion";
export const DESKTOP_UI_KEY_UPDATES_DISMISSED_VERSION = "updates.dismissedVersion";
/** ISO-8601 — suppress auto-check result modal until this instant. */
export const DESKTOP_UI_KEY_UPDATES_SNOOZE_UNTIL = "updates.snoozeUntil";

export const DESKTOP_UI_DEFAULTS: Record<string, string> = {
  [DESKTOP_UI_KEY_THEME]: "light",
  [DESKTOP_UI_KEY_CHAT_RICH_TEXT]: "false",
  [DESKTOP_UI_KEY_UPDATES_AUTO_CHECK]: "true",
};

export interface DesktopAppUiPreferences {
  get(key: string): Promise<Result<string | undefined, AppError>>;
  set(key: string, value: string): Promise<void>;
}

export function createDesktopAppUiPreferences(
  kkv: KkvService,
): DesktopAppUiPreferences {
  return {
    async get(key: string): Promise<Result<string | undefined, AppError>> {
      const raw = await kkv.get(DESKTOP_UI_KKV_MODULE, key);
      if (!raw.ok) {
        if (isAppError(raw.error, "KKV_NOT_FOUND")) {
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
