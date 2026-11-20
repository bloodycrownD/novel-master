import {AppVersionGuard} from '../src/storage/app-version-guard';
import type {AppUiPreferences} from '../src/storage/app-ui-prefs';
import {
  APP_UI_KEY_LAST_RUN_VERSION,
  APP_UI_KEY_RICH_RENDER_EPOCH,
} from '../src/storage/app-ui-keys';

function mockAppUi(initial: Record<string, string> = {}): AppUiPreferences {
  const store = {...initial};
  return {
    // 错误通道迁移四期：get 走 Result（未写值归一 undefined）。
    async get(key: string) {
      return {ok: true as const, value: store[key]};
    },
    async set(key: string, value: string) {
      store[key] = value;
    },
    async delete(key: string) {
      delete store[key];
      return {ok: true as const, value: undefined};
    },
    async listKeys() {
      return Object.keys(store);
    },
  };
}

describe('app-version-guard', () => {
  it('keeps epoch when version unchanged', async () => {
    const appUi = mockAppUi({
      [APP_UI_KEY_LAST_RUN_VERSION]: '1.0.0',
      [APP_UI_KEY_RICH_RENDER_EPOCH]: '3',
    });
    const syncResult = await AppVersionGuard.syncAppVersionForRichRender(appUi, '1.0.0');
    if (!syncResult.ok) throw syncResult.error;
    expect(syncResult.value).toBe(3);
    expect((await appUi.get(APP_UI_KEY_RICH_RENDER_EPOCH)).value).toBe('3');
  });

  it('increments epoch when version changes', async () => {
    const appUi = mockAppUi({
      [APP_UI_KEY_LAST_RUN_VERSION]: '1.0.0',
      [APP_UI_KEY_RICH_RENDER_EPOCH]: '2',
    });
    const syncResult = await AppVersionGuard.syncAppVersionForRichRender(appUi, '1.0.1');
    if (!syncResult.ok) throw syncResult.error;
    expect(syncResult.value).toBe(3);
    expect((await appUi.get(APP_UI_KEY_LAST_RUN_VERSION)).value).toBe('1.0.1');
    expect((await appUi.get(APP_UI_KEY_RICH_RENDER_EPOCH)).value).toBe('3');
  });
});
