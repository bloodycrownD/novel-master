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
    /** Android 且 Kotlin 模块的流式方法面（sseConnect/sseAbort）可用时为 true（iOS / 测试环境 false，装配点据此跳过注册回落 XHR）。 */
    export function isAvailable(): boolean {
        // 只探测流式必需的两个方法（属性访问而非 spread 枚举：bridgeless lazy
        // jsRepresentation 的方法要靠属性访问实体化）。request/requestAbort 是
        // 非流式 shim 的方法面，由 setup-llm-fetch 自行探测退化——流式可用性
        // 探测不得被非流式方法面绑死（2026-11-22 真机实锤：旧 APK 三方法面 ×
        // 四方法探测 → requestAbort 缺失 → native 永不接管、流式全走 XHR 黑盒）。
        return Platform.OS === "android" && nativeModule != null && typeof nativeModule.sseConnect === "function" && typeof nativeModule.sseAbort === "function";
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
        // 「已被访问过」的方法子集：isAvailable 只访问过 sseConnect，sseAbort 缺失
        // → 终止链 bridge.sseAbort 为 undefined，abort 时抛 "undefined is not a
        // function" 且连接不断（挂死 run 只能等 callTimeout 兜底）。
        // 解构的属性访问走原型查找，方法引用在此刻全部取到。request/requestAbort
        // 是非流式方法面，流式 bridge 不携带（types.ts LlmSseNativeBridge 注记）。
        const {sseConnect, sseAbort} = nativeModule;
        return {sseConnect, sseAbort, events};
    }

    /** 已缓存的 transport 单例槽（共享事件订阅，避免重复 addListener）。 */
    const transportSlot = { current: undefined as SseTransport | undefined };

    /** 基于静态 native 绑定构建 SseTransport；native 不可用时抛错（先经 {@link NativeSse.isAvailable} 判定）。 */
    export function createTransport(): SseTransport {
        if (transportSlot.current != null) {
            return transportSlot.current;
        }
        const bridge = createBridge();
        if (bridge == null) {
            // nm-throw: keep — 平台强制：本包设计上不依赖 core（无 Result/assert 通道可用），native bridge 装配失败以 throw 上行；装配点 registerWith 已先经 isAvailable 门控，直调不可用属编程误用。
            throw new Error("LlmSseNative 模块不可用（非 Android 或未 autolink）；请先经 NativeSse.isAvailable() 判定",);
        }
        transportSlot.current = NativeSseTransport.create(bridge);
        return transportSlot.current;
    }

    /** @internal 重置单例（测试用）。 */
    export function resetTransportForTests(): void {
        transportSlot.current = undefined;
    }

    /**
   * 注册进注入的 register（core 侧 `registerSseTransport` 的依赖注入形态——
   * 本包不依赖 core 运行时，装配点（apps/mobile）负责把 core 的注册函数传进来）。
   *
   * @returns native 是否可用并已完成注册；false 时装配点应跳过（transport 择优回落 XHR）。
   */
    export function registerWith(register: (transport: SseTransport) => void,): boolean {
        if (!isAvailable()) {
            // 失败诊断由装配点（apps/mobile setup-llm-fetch）经 logger 记录——本包不依赖
            // core 运行时、没有日志通道；registerWith 只返回事实，不产生裸 console 日志。
            return false;
        }
        register(createTransport());
        return true;
    }
}
