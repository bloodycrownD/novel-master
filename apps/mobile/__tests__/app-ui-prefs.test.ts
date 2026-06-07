import {KkvError} from '@novel-master/core';
import type {KkvService} from '@novel-master/core/kkv';
import {
  APP_UI_DEFAULTS,
  APP_UI_KKV_MODULE,
  APP_UI_KEY_THEME,
} from '../src/storage/app-ui-keys';
import {createAppUiPreferences, appUiKeys} from '../src/storage/app-ui-prefs';

function createMemoryKkv(): KkvService {
  const data = new Map<string, string>();
  const compound = (module: string, key: string) => `${module}\0${key}`;

  return {
    async listKeys(module: string) {
      const prefix = `${module}\0`;
      return [...data.keys()]
        .filter(k => k.startsWith(prefix))
        .map(k => k.slice(prefix.length));
    },
    async get(module: string, key: string) {
      const v = data.get(compound(module, key));
      if (v === undefined) {
        throw new KkvError('NOT_FOUND', 'missing', {module, key});
      }
      return v;
    },
    async set(module: string, key: string, value: string) {
      data.set(compound(module, key), value);
    },
    async delete(module: string, key: string) {
      const k = compound(module, key);
      if (!data.has(k)) {
        throw new KkvError('NOT_FOUND', 'missing', {module, key});
      }
      data.delete(k);
    },
  };
}

describe('createAppUiPreferences', () => {
  it('returns default theme when key is missing', async () => {
    const prefs = createAppUiPreferences(createMemoryKkv());
    await expect(prefs.get(appUiKeys.theme)).resolves.toBe(
      APP_UI_DEFAULTS[APP_UI_KEY_THEME],
    );
  });

  it('round-trips set and get', async () => {
    const kkv = createMemoryKkv();
    const prefs = createAppUiPreferences(kkv);
    await prefs.set(appUiKeys.theme, 'dark');
    await expect(prefs.get(appUiKeys.theme)).resolves.toBe('dark');
    await expect(kkv.get(APP_UI_KKV_MODULE, APP_UI_KEY_THEME)).resolves.toBe(
      'dark',
    );
  });

  it('delete is idempotent for missing keys', async () => {
    const prefs = createAppUiPreferences(createMemoryKkv());
    await expect(prefs.delete(appUiKeys.theme)).resolves.toBeUndefined();
  });

  it('returns undefined for unknown keys', async () => {
    const prefs = createAppUiPreferences(createMemoryKkv());
    await expect(prefs.get('unknown-key')).resolves.toBeUndefined();
  });
});
