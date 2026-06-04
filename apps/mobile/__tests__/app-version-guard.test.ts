import {
  readRichRenderEpoch,
  syncAppVersionForRichRender,
} from '../src/storage/app-version-guard';
import type {AppUiPreferences} from '../src/storage/app-ui-prefs';
import {
  APP_UI_KEY_LAST_RUN_VERSION,
  APP_UI_KEY_RICH_RENDER_EPOCH,
} from '../src/storage/app-ui-keys';

function mockAppUi(initial: Record<string, string> = {}): AppUiPreferences {
  const store = {...initial};
  return {
    async get(key: string) {
      return store[key];
    },
    async set(key: string, value: string) {
      store[key] = value;
    },
    async delete(key: string) {
      delete store[key];
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
    const epoch = await syncAppVersionForRichRender(appUi, '1.0.0');
    expect(epoch).toBe(3);
    expect(await readRichRenderEpoch(appUi)).toBe(3);
  });

  it('increments epoch when version changes', async () => {
    const appUi = mockAppUi({
      [APP_UI_KEY_LAST_RUN_VERSION]: '1.0.0',
      [APP_UI_KEY_RICH_RENDER_EPOCH]: '2',
    });
    const epoch = await syncAppVersionForRichRender(appUi, '1.0.1');
    expect(epoch).toBe(3);
    expect(await appUi.get(APP_UI_KEY_LAST_RUN_VERSION)).toBe('1.0.1');
    expect(await appUi.get(APP_UI_KEY_RICH_RENDER_EPOCH)).toBe('3');
  });
});
