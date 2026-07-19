/**
 * rich-document → RN postMessage 出口（无业务依赖，避免 bridge↔annotate 环）。
 */
import { BRIDGE_V } from './document-model';

/** RN WebView 注入的 postMessage 桥（宿主 API）。 */
type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
  }
}

export function post(type: string, payload?: Record<string, unknown>): void {
  const msg = JSON.stringify({
    v: BRIDGE_V,
    type: type,
    payload: payload || {},
  });
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(msg);
  }
}
