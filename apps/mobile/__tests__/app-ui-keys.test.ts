import {
  APP_UI_DEFAULTS,
  APP_UI_KKV_MODULE,
  APP_UI_KEY_CHAT_RICH_TEXT,
  APP_UI_KEY_CHAT_STREAM_BATCH_ENABLED,
  APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE,
  APP_UI_KEY_THEME,
  APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE,
} from '../src/storage/app-ui-keys';

describe('app-ui-keys', () => {
  it('uses nm-mobile-ui module', () => {
    expect(APP_UI_KKV_MODULE).toBe('nm-mobile-ui');
  });

  it('defines light theme default', () => {
    expect(APP_UI_DEFAULTS[APP_UI_KEY_THEME]).toBe('light');
  });

  it('defaults chat rich text to off', () => {
    expect(APP_UI_DEFAULTS[APP_UI_KEY_CHAT_RICH_TEXT]).toBe('false');
  });

  it('centralizes engine/flag keys formerly scattered in their pref modules', () => {
    expect(APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE).toBe('chatTranscriptEngine');
    expect(APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE).toBe(
      'vfsMarkdownPreviewEngine',
    );
    expect(APP_UI_KEY_CHAT_STREAM_BATCH_ENABLED).toBe('chatStreamBatchEnabled');
  });
});
