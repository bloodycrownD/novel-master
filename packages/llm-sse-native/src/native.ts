/**
 * RN / Metro 入口：静态绑定 NativeModules.LlmSseNative + NativeEventEmitter
 * （mirrors tdbc-driver-op-sqlite/native 的双入口模式）。
 *
 * @module llm-sse-native/native
 */

import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { createNativeSseTransportFromBridge } from "./transport.js";
import type {
  LlmSseEventSink,
  LlmSseNativeBridge,
  LlmSseNativeModule,
  SseTransport,
} from "./types.js";

export type {
  LlmSseChunkEvent,
  LlmSseDoneEvent,
  LlmSseErrorEvent,
  LlmSseEventSink,
  LlmSseHeadersEvent,
  LlmSseNativeBridge,
  LlmSseNativeModule,
  SseTransport,
} from "./types.js";
export {
  NativeSseAbortError,
  NativeSseTransportError,
  createNativeSseTransportFromBridge,
  flattenRequestHeaders,
} from "./transport.js";

const nativeModule = NativeModules.LlmSseNative as
  | LlmSseNativeModule
  | undefined;

/** Android 且 Kotlin 模块已 autolink 时为 true（iOS / 测试环境 false，装配点据此跳过注册回落 XHR）。 */
export function isNativeSseAvailable(): boolean {
  return (
    Platform.OS === "android" &&
    nativeModule != null &&
    typeof nativeModule.sseConnect === "function" &&
    typeof nativeModule.request === "function"
  );
}

/** 组装生产 bridge：NativeEventEmitter 订阅四类事件（bridgeless 下无参构造走全局发射器）。 */
function createBridge(): LlmSseNativeBridge | null {
  if (!isNativeSseAvailable() || nativeModule == null) {
    return null;
  }
  const emitter = new NativeEventEmitter();
  const events: LlmSseEventSink = {
    addListener(name, listener) {
      const subscription = emitter.addListener(name, listener);
      return () => {
        subscription.remove();
      };
    },
  };
  return { ...nativeModule, events };
}

/** 已缓存的 transport 单例（共享事件订阅，避免重复 addListener）。 */
let cachedTransport: SseTransport | null = null;

/** 基于静态 native 绑定构建 SseTransport；native 不可用时抛错（先经 {@link isNativeSseAvailable} 判定）。 */
export function createNativeSseTransport(): SseTransport {
  if (cachedTransport != null) {
    return cachedTransport;
  }
  const bridge = createBridge();
  if (bridge == null) {
    throw new Error(
      "LlmSseNative 模块不可用（非 Android 或未 autolink）；请先经 isNativeSseAvailable() 判定",
    );
  }
  cachedTransport = createNativeSseTransportFromBridge(bridge);
  return cachedTransport;
}

/** @internal 重置单例（测试用）。 */
export function resetNativeSseTransportForTests(): void {
  cachedTransport = null;
}

/**
 * 注册进注入的 register（core 侧 `registerSseTransport` 的依赖注入形态——
 * 本包不依赖 core 运行时，装配点（apps/mobile）负责把 core 的注册函数传进来）。
 *
 * @returns native 是否可用并已完成注册；false 时装配点应跳过（transport 择优回落 XHR）。
 */
export function registerNativeSseTransportWith(
  register: (transport: SseTransport) => void,
): boolean {
  if (!isNativeSseAvailable()) {
    return false;
  }
  register(createNativeSseTransport());
  return true;
}
