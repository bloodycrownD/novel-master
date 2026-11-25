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
import {LogFactory} from '@novel-master/core/log';
import {NativeSse, type LlmSseNativeModule} from '@novel-master/llm-sse-native/native';
import {LlmNativeFetchShim, type LlmNativeRequestDeps} from '../services/llm-native-fetch-shim';

const log = LogFactory.create('llm.sse-native');

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
        const nativeRegistered = NativeSse.registerWith(LlmSseTransport.register);
        const nativeModule = NativeModules.LlmSseNative as LlmSseNativeModule | undefined;
        // 注册结果落文件日志（native 未接管曾静默数月）：成功 info 一条；失败 warn 并带原生
        // 方法面，一眼可辨是模块缺失还是方法面不全（如旧安装包缺方法）。
        const methodFace = nativeModule == null ? 'module=undefined' : ['sseConnect', 'sseAbort', 'request', 'requestAbort'].filter((k) => typeof nativeModule[k as keyof LlmSseNativeModule] === 'function').join(',');
        if (nativeRegistered) {
            log.info('native SSE transport 注册结果: 成功(registered)', {methodFace});
        } else {
            log.warn(`native SSE transport 注册结果: 失败(isAvailable=false, methodFace=${methodFace})`);
        }
        // 装配工厂（原 createMobileLlmFetch）：native request 可用（Android 且已
        // autolink）→ 以它为底座的 fetch shim；不可用（iOS 工程 / Jest 环境）→ 回落
        // `globalThis.fetch`——发布面仅 Android，iOS 只是开发调试面，缺 native 不应
        // 炸掉全部非流式请求。调用时求值 native 底座。
        const request = nativeModule == null || typeof nativeModule.request !== 'function' ? null : nativeModule.request.bind(nativeModule);
        // requestAbort 缺失（旧 native 构建）不阻塞装配：退化为仅本地取消，仍保留
        // native 连接池与整调用 callTimeout，比回落 globalThis.fetch 更接近生产行为。
        const requestAbort = nativeModule == null || typeof nativeModule.requestAbort !== 'function' ? null : nativeModule.requestAbort.bind(nativeModule);
        let shim: typeof globalThis.fetch;
        if (request != null) {
            // fetch 签名的消费方不传依赖：在这里把 native 依赖绑进去（唯一的一处包装）。
            const nativeDeps: LlmNativeRequestDeps = requestAbort == null ? {request} : {request, requestAbort};
            shim = ((input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => LlmNativeFetchShim.performRequest(nativeDeps, input, init)) as unknown as typeof globalThis.fetch;
        } else {
            if (!setupState.fallbackWarned) {
                setupState.fallbackWarned = true;
                log.warn('LlmSseNative request 底座不可用，非流式请求回落 globalThis.fetch');
            }
            shim = globalThis.fetch;
        }
        Registry.configureLlmFetch(typeof __DEV__ !== 'undefined' && __DEV__ ? DebugFetch.createLoggingFetch(shim) : shim);
    },
} as const;
