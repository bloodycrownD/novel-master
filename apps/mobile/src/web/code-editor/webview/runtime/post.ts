/**
 * code-editor → RN postMessage 出口。
 */
import { BRIDGE_V } from './model';

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
