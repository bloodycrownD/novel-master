/**
 * RichDocument WebView 包 id。
 *
 * 只导出包 id，平台 URI 换算法在 `webview-host/webview-asset-uri.ts`
 * （Android android_asset / iOS MainBundle WebViewDist，同步返回、不做 exists 探测）。
 */
import type {WebViewAssetPackageId} from '@/webview-host/webview-asset-uri';

export const RICH_DOCUMENT_WEBVIEW_PACKAGE_ID = 'rich-document' satisfies WebViewAssetPackageId;
