/**
 * Feature flag: plain-text RN rollback vs WebView for VFS markdown preview body.
 *
 * Default: `webview`. Override via KKV `vfsMarkdownPreviewEngine` (`rn` | `webview`)
 * for rollback without reinstalling.
 */
import {APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE} from './app-ui-keys';
import {readEnumPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

export type VfsMarkdownPreviewEngine = 'rn' | 'webview';

const DEFAULT_ENGINE: VfsMarkdownPreviewEngine = 'webview';
const ALLOWED_ENGINES: readonly VfsMarkdownPreviewEngine[] = ['rn', 'webview'];

export function defaultVfsMarkdownPreviewEngine(): VfsMarkdownPreviewEngine {
  return DEFAULT_ENGINE;
}

export async function readVfsMarkdownPreviewEngine(
  appUi: AppUiPreferences | null | undefined,
): Promise<VfsMarkdownPreviewEngine> {
  return readEnumPref(
    appUi,
    APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE,
    ALLOWED_ENGINES,
    DEFAULT_ENGINE,
  );
}
