/**
 * RichDocument WebView 本地加载 URI helper。
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '../webview-asset-uri';

/** 返回 rich-document 包 `index.html` 的平台 URI（同步；不做 exists 探测）。 */
export function getRichDocumentUri(): string {
  return getWebViewPackageIndexUri('rich-document');
}

/** 包目录 URI，供 iOS `allowingReadAccessToURL`。 */
export function getRichDocumentPackageDirUri(): string {
  return getWebViewPackageDirUri('rich-document');
}
