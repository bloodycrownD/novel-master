/**
 * Feature flag: plain-text RN rollback vs WebView for VFS markdown preview body.
 *
 * Default: `webview`. Override via KKV `vfsMarkdownPreviewEngine` (`rn` | `webview`)
 * for rollback without reinstalling.
 */
import {APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE} from './app-ui-keys';
import {AppUiPrefIo} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

export type VfsMarkdownPreviewEngine = 'rn' | 'webview';

const DEFAULT_ENGINE: VfsMarkdownPreviewEngine = 'webview';
const ALLOWED_ENGINES: readonly VfsMarkdownPreviewEngine[] = ['rn', 'webview'];

export const VfsMarkdownPreviewEngine = {
    default: (): VfsMarkdownPreviewEngine => {
        return DEFAULT_ENGINE;
    },

    read: async (appUi: AppUiPreferences | null | undefined): Promise<VfsMarkdownPreviewEngine> => {
        return AppUiPrefIo.readEnumPref(appUi, APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE, ALLOWED_ENGINES, DEFAULT_ENGINE);
    },
} as const;
