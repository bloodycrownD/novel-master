/**
 * ComposerInput WebView 本地加载 URI helper。
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '@/webview-host/webview-asset-uri';

/** 返回 composer-input 包 `index.html` 的平台 URI（同步；不做 exists 探测）。 */
export function getComposerInputUri(): string {
  return getWebViewPackageIndexUri('composer-input');
}

/** 包目录 URI，供 iOS `allowingReadAccessToURL`。 */
export function getComposerInputPackageDirUri(): string {
  return getWebViewPackageDirUri('composer-input');
}
