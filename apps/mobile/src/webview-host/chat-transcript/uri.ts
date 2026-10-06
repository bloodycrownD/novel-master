/**
 * ChatTranscript WebView 本地加载 URI helper（composer-native-2026-10 Step 5）。
 *
 * 与 chat-conversation/uri.ts 同形状：只做包 id → 平台 URI 的换算，路径真源在
 * `webview-asset-uri.ts`（构建脚本按同一 id 产出 webview-dist 与两端原生落点）。
 *
 * 来历：转录侧自 chat-conversation 合成包拆回独立文档包（Step 2 建包、Step 5
 * 宿主切换加载源）；chat-conversation 合成包过渡期仍在构建，其 uri helper 待
 * Step 6 随包退役。
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '@/webview-host/webview-asset-uri';

/** 返回 chat-transcript 包 `index.html` 的平台 URI（同步；不做 exists 探测）。 */
export function getChatTranscriptUri(): string {
  return getWebViewPackageIndexUri('chat-transcript');
}

/** 包目录 URI，供 iOS `allowingReadAccessToURL`（相对 ./app.js / ./app.css）。 */
export function getChatTranscriptPackageDirUri(): string {
  return getWebViewPackageDirUri('chat-transcript');
}
