/**
 * WebView → RN postMessage 统一出口（无业务依赖）。
 * 各 webview 自身的 BRIDGE_V 由调用方作为参数传入，避免与具体模型耦合。
 */

/** RN WebView 注入的 postMessage 桥（宿主 API）。 */
export type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
  }
}

/**
 * 向 RN 发送一条消息。
 * @param type     消息类型
 * @param payload  负载（可选）
 * @param bridgeV  调用方 webview 的 BRIDGE_V，写入消息头 `v`
 */
export function post(
  type: string,
  payload: Record<string, unknown> | undefined,
  bridgeV: number,
): void {
  const msg = JSON.stringify({
    v: bridgeV,
    type: type,
    payload: payload || {},
  });
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(msg);
  }
}

/** 绑定固定 BRIDGE_V 的 post（各 webview 域一行接入，消息头 `v` 恒为 bridgeV）。 */
export type BoundPost = (
  type: string,
  payload?: Record<string, unknown>,
) => void;

export function createBoundPost(bridgeV: number): BoundPost {
  return (type, payload) => {
    post(type, payload, bridgeV);
  };
}
