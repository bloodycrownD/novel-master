/**
 * Desktop UI preferences backed by KKV module `nm-desktop-ui`.
 *
 * @module storage/app-ui-prefs
 */
import { KkvError, type KkvService } from "@novel-master/core";

export const DESKTOP_UI_KKV_MODULE = "nm-desktop-ui";

export const DESKTOP_UI_KEY_THEME = "theme";

export const DESKTOP_UI_DEFAULTS: Record<string, string> = {
  [DESKTOP_UI_KEY_THEME]: "light",
};

export interface DesktopAppUiPreferences {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export function createDesktopAppUiPreferences(
  kkv: KkvService,
): DesktopAppUiPreferences {
  return {
    async get(key: string) {
      try {
        return await kkv.get(DESKTOP_UI_KKV_MODULE, key);
      } catch (error) {
        if (error instanceof KkvError && error.code === "NOT_FOUND") {
          return key in DESKTOP_UI_DEFAULTS
            ? DESKTOP_UI_DEFAULTS[key]
            : undefined;
        }
        throw error;
      }
    },
    async set(key: string, value: string) {
      await kkv.set(DESKTOP_UI_KKV_MODULE, key, value);
    },
  };
}
