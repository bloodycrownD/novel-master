/**
 * LLM 传输装配（runtime 初始化链调用，须早于首个 LLM 请求）。
 *
 * - 流式：注册 native SSE transport（`registerNativeSseTransportWith` 依赖
 *   注入 core 的 `LlmSseTransport.register`；native 缺位返回 false 安全跳过，
 *   postSse 择优自动回落 XHR，不炸启动）。
 * - 非流式：注册 fetch shim（llm-sse-native `request` 底座）——生产/开发
 *   统一注册，获得整调用 callTimeout 与 native 连接池（spec
 *   llm-stream-native §4）；`__DEV__` 下组合顺序写死 **logging 最外层包
 *   shim**（`DebugFetch.createLoggingFetch(shim)`——dev 日志覆盖全部非流式流量，包括
 *   走 native 底座的请求；shim 内部零组合逻辑）。生产构建 logging 不参与。
 *
 * 镜像注：desktop 同名入口在 apps/desktop/src/main/runtime/setup-llm-fetch.ts。
 * 两端**不**逐字镜像——desktop 只在调试开关下安装 logging fetch；本端固定注册
 * native SSE transport + mobile fetch shim。平台底座不同，故保留双端、不收敛到 core。
 *
 * @module runtime/setup-llm-fetch
 */

import {NativeModules} from 'react-native';
import {DebugFetch, LlmSseTransport, Registry} from '@novel-master/core/llm-protocol';
import {NativeSse, type LlmSseNativeModule} from '@novel-master/llm-sse-native/native';
import {LlmNativeFetchShim} from '../services/llm-native-fetch-shim';

/** 装配状态（模块内 holder，对象管理）：每进程注册一次 + 回落告警只打一次。 */
const setupState = {
  configured: false,
  fallbackWarned: false,
};

export const LlmFetchSetup = {
  /** 每进程注册一次：native SSE transport + 非流式 fetch shim。 */
  ensureConfigured: (): void => {
    if (setupState.configured) {
      return;
    }
    setupState.configured = true;
    NativeSse.registerWith(LlmSseTransport.register);
    // 装配工厂（原 createMobileLlmFetch）：native request 可用（Android 且已
    // autolink）→ 以它为底座的 fetch shim；不可用（iOS 工程 / Jest 环境）→ 回落
    // `globalThis.fetch`——发布面仅 Android，iOS 只是开发调试面，缺 native 不应
    // 炸掉全部非流式请求。调用时求值 native 底座。
    const nativeModule = NativeModules.LlmSseNative as LlmSseNativeModule | undefined;
    const request = nativeModule == null || typeof nativeModule.request !== 'function' ? null : nativeModule.request.bind(nativeModule);
    // requestAbort 缺失（旧 native 构建）不阻塞装配：退化为仅本地取消，仍保留
    // native 连接池与整调用 callTimeout，比回落 globalThis.fetch 更接近生产行为。
    const requestAbort = nativeModule == null || typeof nativeModule.requestAbort !== 'function' ? null : nativeModule.requestAbort.bind(nativeModule);
    let shim: ReturnType<typeof LlmNativeFetchShim.create> | typeof globalThis.fetch;
    if (request != null) {
      shim = LlmNativeFetchShim.create(requestAbort == null ? {request} : {request, requestAbort});
    } else {
      if (!setupState.fallbackWarned) {
        setupState.fallbackWarned = true;
        console.warn('[nm-llm] LlmSseNative request 底座不可用，非流式请求回落 globalThis.fetch');
      }
      shim = globalThis.fetch;
    }
    Registry.configureLlmFetch(typeof __DEV__ !== 'undefined' && __DEV__ ? DebugFetch.createLoggingFetch(shim) : shim);
  },
} as const;
