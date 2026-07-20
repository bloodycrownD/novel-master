/**
 * CodeEditor WebView 本地加载 URI helper。
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '../webview-asset-uri';

/** 返回 code-editor 包 `index.html` 的平台 URI（同步；不做 exists 探测）。 */
export function getCodeEditorUri(): string {
  return getWebViewPackageIndexUri('code-editor');
}

/** 包目录 URI，供 iOS `allowingReadAccessToURL`。 */
export function getCodeEditorPackageDirUri(): string {
  return getWebViewPackageDirUri('code-editor');
}
