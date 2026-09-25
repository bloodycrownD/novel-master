/**
 * 测试用 fake bridge：记录 native 调用、允许手工注入四类事件。
 * NativeEventEmitter 的 emit 是同步回调，这里保持同构（同步派发）。
 */

import type {
  LlmSseEventSink,
  LlmSseNativeBridge,
  LlmSseNativeModule,
} from "../src/types.js";

export interface MockBridge {
  bridge: LlmSseNativeBridge;
  /** sseConnect 调用记录（按到达顺序）。 */
  connects: Array<{
    requestId: string;
    url: string;
    headersKv: string[];
    body: string;
    readTimeoutMs: number;
    callTimeoutMs: number;
  }>;
  /** sseAbort 调用记录。 */
  aborts: string[];
  /** 注入一个 native 事件（同步派发给 wrapper 的 listener）。 */
  emit(name: string, event: unknown): void;
}

export function createMockBridge(): MockBridge {
  const connects: MockBridge["connects"] = [];
  const aborts: string[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();

  const events: LlmSseEventSink = {
    addListener(name, listener) {
      let set = listeners.get(name);
      if (set == null) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
      };
    },
  };

  const module: LlmSseNativeModule = {
    sseConnect(requestId, url, headersKv, body, readTimeoutMs, callTimeoutMs) {
      connects.push({ requestId, url, headersKv, body, readTimeoutMs, callTimeoutMs });
    },
    sseAbort(requestId) {
      aborts.push(requestId);
    },
    request() {
      return Promise.reject(new Error("not used in these tests"));
    },
  };

  return {
    bridge: { ...module, events },
    connects,
    aborts,
    emit(name, event) {
      for (const listener of listeners.get(name) ?? []) {
        listener(event);
      }
    },
  };
}
