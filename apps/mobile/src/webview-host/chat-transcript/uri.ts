/**
 * ChatTranscript WebView 本地加载 URI helper。
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '../webview-asset-uri';

/** 返回 chat-transcript 包 `index.html` 的平台 URI（同步；不做 exists 探测）。 */
export function getChatTranscriptUri(): string {
  return getWebViewPackageIndexUri('chat-transcript');
}

/** 包目录 URI，供 iOS `allowingReadAccessToURL`。 */
export function getChatTranscriptPackageDirUri(): string {
  return getWebViewPackageDirUri('chat-transcript');
}
