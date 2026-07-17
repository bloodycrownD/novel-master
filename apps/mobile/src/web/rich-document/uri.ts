/**
 * RichDocument WebView ???? URI helper?
 */
import {
  getWebViewPackageDirUri,
  getWebViewPackageIndexUri,
} from '../webview-asset-uri';

/** ?? rich-document ? `index.html` ??? URI?????? exists ???? */
export function getRichDocumentUri(): string {
  return getWebViewPackageIndexUri('rich-document');
}

/** ??? URI?? iOS `allowingReadAccessToURL`? */
export function getRichDocumentPackageDirUri(): string {
  return getWebViewPackageDirUri('rich-document');
}
