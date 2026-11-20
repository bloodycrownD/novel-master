/**
 * RN / Metro 入口：静态绑定 NativeModules.LlmSseNative + NativeEventEmitter
 * （mirrors tdbc-driver-op-sqlite/native 的双入口模式）。
 *
 * @module llm-sse-native/native
 */

import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { NativeSseTransport } from "./transport.js";
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
  NativeSseTransport,
} from "./transport.js";

const nativeModule = NativeModules.LlmSseNative as | LlmSseNativeModule | undefined;

// nm-style 注记：文件名 native 太泛，按内容主体起名（NativeSse）。
export namespace NativeSse {
  /** Android 且 Kotlin 模块已 autolink 时为 true（iOS / 测试环境 false，装配点据此跳过注册回落 XHR）。 */
  export function isAvailable(): boolean {
    // 四个方法逐个 typeof 访问（而非 spread/keys 枚举）：bridgeless lazy
    // jsRepresentation 的方法要靠属性访问实体化，sseAbort / requestAbort 必须
    // 在此显式探测（stop-button P0：漏探测导致 spread bridge 缺该方法；取消对
    // request 路径同样是「方法缺失 → 静默失效、连接跑满 callTimeout」）。
    return (
      Platform.OS === "android" &&
      nativeModule != null &&
      typeof nativeModule.sseConnect === "function" &&
      typeof nativeModule.sseAbort === "function" &&
      typeof nativeModule.request === "function" &&
      typeof nativeModule.requestAbort === "function"
    );
  }

  /** 组装生产 bridge：NativeEventEmitter 订阅四类事件（bridgeless 下无参构造走全局发射器）。 */
  function createBridge(): LlmSseNativeBridge | null {
    if (!isAvailable() || nativeModule == null) {
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
    // 逐方法解构而非 {...nativeModule} spread（stop-button P0 修复）：
    // bridgeless 下 NativeModules.X 返回 lazy jsRepresentation——初始为空对象，
    // 方法挂 HostObject 原型上、首次属性访问才实体化为 own property（见 RN
    // TurboModuleBinding.getModule）。spread 只枚举 own property，拿到的是
    // 「已被访问过」的方法子集：isAvailable 只访问过 sseConnect/
    // request，sseAbort 缺失 → 终止链 bridge.sseAbort 为 undefined，abort
    // 时抛 "undefined is not a function" 且连接不断（挂死 run 只能等 callTimeout 兜底）。
    // requestAbort 同款：非流式取消靠它真断连，spread 漏掉就退化成假取消。
    // 解构的属性访问走原型查找，四个方法引用在此刻全部取到。
    const {sseConnect, sseAbort, request, requestAbort} = nativeModule;
    return {sseConnect, sseAbort, request, requestAbort, events};
  }

  /** 已缓存的 transport 单例（共享事件订阅，避免重复 addListener）。 */
  let cachedTransport: SseTransport | null = null;

  /** 基于静态 native 绑定构建 SseTransport；native 不可用时抛错（先经 {@link NativeSse.isAvailable} 判定）。 */
  export function createTransport(): SseTransport {
    if (cachedTransport != null) {
      return cachedTransport;
    }
    const bridge = createBridge();
    if (bridge == null) {
      // nm-throw: keep — native bridge 边界：LlmSseNative 模块不可用（非 Android / 未 autolink），须先经 isAvailable 判定。
      throw new Error("LlmSseNative 模块不可用（非 Android 或未 autolink）；请先经 NativeSse.isAvailable() 判定",);
    }
    cachedTransport = NativeSseTransport.create(bridge);
    return cachedTransport;
  }

  /** @internal 重置单例（测试用）。 */
  export function resetTransportForTests(): void {
    cachedTransport = null;
  }

  /**
   * 注册进注入的 register（core 侧 `registerSseTransport` 的依赖注入形态——
   * 本包不依赖 core 运行时，装配点（apps/mobile）负责把 core 的注册函数传进来）。
   *
   * @returns native 是否可用并已完成注册；false 时装配点应跳过（transport 择优回落 XHR）。
   */
  export function registerWith(register: (transport: SseTransport) => void,): boolean {
    if (!isAvailable()) {
      return false;
    }
    register(createTransport());
    return true;
  }
}
