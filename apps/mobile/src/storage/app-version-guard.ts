/**
 * App version guard: bumps rich-text render epoch when package version changes.
 *
 * @module storage/app-version-guard
 */
import {Result, AppError} from '@novel-master/core/errors';
import type {AppUiPreferences} from './app-ui-prefs';
import {APP_UI_KEY_LAST_RUN_VERSION, APP_UI_KEY_RICH_RENDER_EPOCH} from './app-ui-keys';

export const AppVersionGuard = {
    /**
   * Compares `currentVersion` to stored last-run version; on change increments epoch.
   * Call once after UI prefs are available at bootstrap.
   *
   * 失败通道（错误通道迁移四期）：读失败沿 `Result.err` 接力给 bootstrap——
   * 与旧异常通道同终端（bootstrap catch → 错误屏），不在 storage 层吞成 0。
   */
    syncAppVersionForRichRender: async (appUi: AppUiPreferences, currentVersion: string): Promise<Result<number, AppError>> => {
        const lastRun = await appUi.get(APP_UI_KEY_LAST_RUN_VERSION);
        if (!lastRun.ok) return Result.err(lastRun.error);
        const storedEpoch = await appUi.get(APP_UI_KEY_RICH_RENDER_EPOCH);
        if (!storedEpoch.ok) return Result.err(storedEpoch.error);
        const parsedEpoch = Number.parseInt(storedEpoch.value ?? '0', 10);
        let epoch = Number.isNaN(parsedEpoch) ? 0 : parsedEpoch;

        if (lastRun.value !== currentVersion) {
            epoch += 1;
            await appUi.set(APP_UI_KEY_LAST_RUN_VERSION, currentVersion);
            await appUi.set(APP_UI_KEY_RICH_RENDER_EPOCH, String(epoch));
        }

        return Result.ok(epoch);
    },
} as const;
