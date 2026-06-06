/**
 * Feature flag: RN RichContentBody vs WebView for VFS markdown preview body.
 *
 * Default: `webview`. Override via KKV `vfsMarkdownPreviewEngine` (`rn` | `webview`)
 * for rollback without reinstalling.
 */
import type {AppUiPreferences} from './app-ui-prefs';

export type VfsMarkdownPreviewEngine = 'rn' | 'webview';

export const APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE = 'vfsMarkdownPreviewEngine';

const DEFAULT_ENGINE: VfsMarkdownPreviewEngine = 'webview';

export function defaultVfsMarkdownPreviewEngine(): VfsMarkdownPreviewEngine {
  return DEFAULT_ENGINE;
}

export async function readVfsMarkdownPreviewEngine(
  appUi: AppUiPreferences | null | undefined,
): Promise<VfsMarkdownPreviewEngine> {
  if (appUi == null) {
    return DEFAULT_ENGINE;
  }
  try {
    const raw = await appUi.get(APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE);
    if (raw === 'rn' || raw === 'webview') {
      return raw;
    }
  } catch {
    // fall through
  }
  return DEFAULT_ENGINE;
}
