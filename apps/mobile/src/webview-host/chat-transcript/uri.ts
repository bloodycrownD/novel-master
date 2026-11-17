/**
 * ChatTranscript WebView 包 id（composer-native-2026-10 Step 5 引入、Step 6 合成包
 * 退役后本文件是转录侧唯一的包身份声明）。
 *
 * 只导出包 id，平台 URI 换算法在 `webview-host/webview-asset-uri.ts`
 * （Android android_asset / iOS MainBundle WebViewDist，同步返回、不做 exists 探测）。
 */
import type {WebViewAssetPackageId} from '@/webview-host/webview-asset-uri';

export const CHAT_TRANSCRIPT_WEBVIEW_PACKAGE_ID = 'chat-transcript' satisfies WebViewAssetPackageId;
