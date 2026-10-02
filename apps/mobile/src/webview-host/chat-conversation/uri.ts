/**
 * ChatConversation WebView 本地加载 URI helper（chat-webview-unify）。
 *
 * 与 chat-transcript/uri.ts 同形状：只做包 id → 平台 URI 的换算，路径真源在
 * `webview-asset-uri.ts`（构建脚本按同一 id 产出 webview-dist 与两端原生落点）。
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '@/webview-host/webview-asset-uri';

/** 返回 chat-conversation 包 `index.html` 的平台 URI（同步；不做 exists 探测）。 */
export function getChatConversationUri(): string {
  return getWebViewPackageIndexUri('chat-conversation');
}

/** 包目录 URI，供 iOS `allowingReadAccessToURL`（相对 ./app.js / ./app.css）。 */
export function getChatConversationPackageDirUri(): string {
  return getWebViewPackageDirUri('chat-conversation');
}
