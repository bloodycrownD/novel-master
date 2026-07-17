/**
 * ChatTranscript WebView ???? URI helper?
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '../webview-asset-uri';

/** ?? chat-transcript ? `index.html` ??? URI?????? exists ???? */
export function getChatTranscriptUri(): string {
  return getWebViewPackageIndexUri('chat-transcript');
}

/** ??? URI?? iOS `allowingReadAccessToURL`? */
export function getChatTranscriptPackageDirUri(): string {
  return getWebViewPackageDirUri('chat-transcript');
}
