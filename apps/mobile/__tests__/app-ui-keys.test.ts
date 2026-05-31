import {
  APP_UI_DEFAULTS,
  APP_UI_KKV_MODULE,
  APP_UI_KEY_THEME,
} from '../src/storage/app-ui-keys';

describe('app-ui-keys', () => {
  it('uses nm-mobile-ui module', () => {
    expect(APP_UI_KKV_MODULE).toBe('nm-mobile-ui');
  });

  it('defines light theme default', () => {
    expect(APP_UI_DEFAULTS[APP_UI_KEY_THEME]).toBe('light');
  });
});
