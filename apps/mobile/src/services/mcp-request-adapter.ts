/**
 * MCP 移动端请求适配（spec mcp-support Step 6）：把 llm-sse-native 的非流式
 * `request` 包成 core `HttpMcpTransport` 注入的请求函数（McpRequestFn）形状；
 * 原生未注册（iOS / Jest / 旧构建缺方法面）回落 `globalThis.fetch`。不走 RN
 * fetch 的原因见 spec「现状约束」：RN 0.85.3 Android 网络栈四类超时全 0，
 * 挂住的请求 Promise 永不 settle——MCP 只在原生缺位时接受这一弱化（回落分支
 * 自带 AbortSignal 定时器兜 timeoutMs，超时语义弱于原生 callTimeout）。
 *
 * 取消：`signal` 已 aborted 立刻以 AbortError 拒绝（请求不发出）；请求途中
 * 中止先调 native `requestAbort(requestId)` 真断连（OkHttp `Call.cancel()`）
 * 再本地立刻 reject——复用 fetch shim 的取消赛跑协议（raceWithAbort），native
 * 迟到 settle 被吞掉，不二次 settle。requestAbort 缺失（旧构建）退化为仅本地
 * 取消，与 fetch shim 同口径。
 *
 * native reject code 映射（spec Step 6）：`network` / `timeout` →
 * McpFailure{kind:"network", action:"retry"}；`abort` → AbortError（core 按
 * name 识别，工具 run 收成 TOOL_CANCELLED，不进 McpFailure）；`invalid` →
 * McpFailure{kind:"protocol", action:"report"}（不应出现，防御性归位）。
 * detail 恒携带原文——「原文透出」在传输失败侧同样成立。
 *
 * 接线：core 的 McpRequestFn / McpFailure 类型由同波次 Step 5 落地
 * （infra/mcp/ports/mcp-transport.port.ts），此处按 spec 写明的签名做鸭子
 * 类型声明，结构兼容即接上；本文件不 import core 运行时。
 *
 * @module services/mcp-request-adapter
 */

import {NativeSseAbortError, NativeSseTransport} from '@novel-master/llm-sse-native';
import type {LlmSseNativeModule} from '@novel-master/llm-sse-native/native';
import {LlmNativeFetchShim} from './llm-native-fetch-shim';

/** core HttpMcpTransport 注入的请求函数形状（按 spec「三、HTTP transport」声明的鸭子类型）。 */
export type McpRequestFn = (req: McpRequestInput) => Promise<McpRequestOutput>;

/** 请求入参：MCP transport 只发整包 JSON（method 只会是 GET/POST，越界即误用）。 */
export interface McpRequestInput {
    readonly url: string;
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string | null;
    readonly signal?: AbortSignal;
}

/** 请求出参：status + 键名小写全头表 + 完整 body 文本（非 2xx 的原文不丢的前提）。 */
export interface McpRequestOutput {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly bodyText: string;
}

/** core domain/mcp/model/mcp-failure.ts 的 McpFailure 鸭子类型声明（adapter 只产出这两种 kind）。 */
export interface McpRequestFailure {
    readonly kind: 'network' | 'protocol';
    readonly action: 'retry' | 'report';
    readonly detail: string;
}

/** native reject 经 adapter 归一的失败：failure 即 spec Step 6 的映射结果，message 与 detail 同为原文。 */
export class McpNativeRequestError extends Error {
    readonly failure: McpRequestFailure;

    constructor(failure: McpRequestFailure) {
        super(failure.detail);
        this.name = 'McpNativeRequestError';
        this.failure = failure;
    }
}

/** adapter 的依赖（双注入：不直连 NativeModules；`request` 为 null = 原生未注册，回落 fetch）。 */
export interface McpRequestAdapterDeps {
    readonly request: LlmSseNativeModule['request'] | null;
    /** 旧 native 构建缺该方法时退化为仅本地取消（连接跑到 callTimeout）。 */
    readonly requestAbort?: LlmSseNativeModule['requestAbort'] | null;
    /** 单请求整调用预算（毫秒）＝ MCP server 配置的 timeoutMs，即原生 callTimeout（配置层已钳 >= 1000）。 */
    readonly timeoutMs: number;
    /** 回落 fetch（测试注入点；缺省 globalThis.fetch）。 */
    readonly fetchFn?: typeof globalThis.fetch;
}

/** requestId 的实例前缀（6 位 base36）：与 fetch shim / 流式 transport 各自独立命名空间（native 侧撞 id 会 reject("invalid")）。 */
const MCP_REQUEST_ID_PREFIX = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/** requestId 自增序号（模块内 holder，对象管理）。 */
const requestIdCounter = {next: 1};

/** native request 的 resolve 形状（`headers` 为键名小写全头表；旧 APK 构建缺该字段）。 */
interface NativeRequestResult {
    status: number;
    contentType: string | null;
    body: string;
    headers?: Record<string, string>;
}

// nm-style 注记：文件名按 spec 项目结构定为 mcp-request-adapter，主体名同名。
// nm-style: keep-public — spec Step 6 的装配接缝：生产接线在 create-mobile-runtime（同波次装配节点 / Step 9），
// 当前生产 0 引用是并行开发中间态，测试先行锁行为。
export const McpRequestAdapter = {
    /**
   * 以注入的 native 方法面构建 McpRequestFn（纯适配器，不读 NativeModules）。
   * `request` 已注册走原生（timeoutMs 即 callTimeout）；未注册回落 fetch。
   */
    create(deps: McpRequestAdapterDeps): McpRequestFn {
        const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
        if (deps.request == null) {
            // nm-style: keep-closure — 回落分支产物本体：捕获 fetchFn/timeoutMs（注入式工厂既定形态）
            return async (req: McpRequestInput): Promise<McpRequestOutput> => {
                const requestId = `mcp-request-${MCP_REQUEST_ID_PREFIX}-${requestIdCounter.next++}`;
                if (req.signal?.aborted === true) {
                    // nm-throw: keep — 平台强制（McpRequestFn AbortError 契约）：aborted signal 立即 reject，请求不发出
                    throw new NativeSseAbortError(requestId);
                }
                // RN fetch 无超时语义：自带 AbortSignal 定时器兜 timeoutMs（spec 风险表——回落分支超时语义弱于原生）。
                const controller = new AbortController();
                // 事件回调契约：addEventListener/removeEventListener 需要稳定引用，不是转手包装。
                const onAbort = (): void => {
                    controller.abort();
                };
                req.signal?.addEventListener('abort', onAbort, {once: true});
                const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
                try {
                    const response = await fetchFn(req.url, {method: req.method, headers: req.headers, body: req.body ?? undefined, signal: controller.signal});
                    const headerTable: Record<string, string> = {};
                    // fetch 规范的 header name 已是小写，toLowerCase 幂等兜 RN 实现细节。
                    response.headers.forEach((value, name) => {
                        headerTable[name.toLowerCase()] = value;
                    });
                    return {status: response.status, headers: headerTable, bodyText: await response.text()};
                } catch (err) {
                    // truthiness 而非 === true：await 之后外层 signal 可能已变 aborted，TS 的
                    // 属性窄化不因 await 失效（#9998），=== 比较会被 CFA 判 no overlap。
                    if (req.signal?.aborted) {
                        // 外层 signal 中止（用户取消 / core 的超时收割）：同归 AbortError，不当失败弹给用户。
                        // nm-throw: keep — 平台强制（McpRequestFn AbortError 契约）
                        throw new NativeSseAbortError(requestId);
                    }
                    if (controller.signal.aborted) {
                        // 自带定时器到点：归 network/retry，不冒充用户取消。
                        // nm-throw: keep — 平台强制（Promise 无 Result 通道）：传输失败以 reject 上行交 transport 归一
                        throw new McpNativeRequestError({kind: 'network', action: 'retry', detail: `call timeout after ${deps.timeoutMs}ms`});
                    }
                    // nm-throw: keep — 同上
                    throw new McpNativeRequestError({kind: 'network', action: 'retry', detail: err instanceof Error ? err.message : String(err)});
                } finally {
                    clearTimeout(timer);
                    req.signal?.removeEventListener('abort', onAbort);
                }
            };
        }
        const {request} = deps;
        const requestAbort = deps.requestAbort ?? undefined;
        // nm-style: keep-closure — native 分支产物本体：捕获注入依赖（注入式工厂既定形态）
        return async (req: McpRequestInput): Promise<McpRequestOutput> => {
            const requestId = `mcp-request-${MCP_REQUEST_ID_PREFIX}-${requestIdCounter.next++}`;
            if (req.method !== 'GET' && req.method !== 'POST') {
                // native 只收 GET/POST（Kotlin 侧按 GET/其余二分），越界属误用：
                // 防御性归位 protocol/report，请求不发出。
                // nm-throw: keep — 平台强制（Promise 无 Result 通道）：误用以 reject 上行
                throw new McpNativeRequestError({kind: 'protocol', action: 'report', detail: `mcp-request 仅支持 GET/POST（收到 ${req.method}）`});
            }
            if (req.signal?.aborted === true) {
                // nm-throw: keep — 平台强制（McpRequestFn AbortError 契约）：aborted signal 立即 reject，请求不发出
                throw new NativeSseAbortError(requestId);
            }
            // 本地取消标记：race 的 abort 分支置位；native 的 "abort" reject 据此与本端主动取消同归 AbortError。
            const cancelState = {userAborted: false};
            try {
                const headersKv = NativeSseTransport.flattenRequestHeaders(req.headers);
                const nativeCall = request(requestId, req.method, req.url, headersKv, req.body, deps.timeoutMs) as Promise<NativeRequestResult>;
                const result = req.signal == null ? await nativeCall : await LlmNativeFetchShim.raceWithAbort({call: nativeCall, signal: req.signal, requestId, requestAbort, cancelState});
                // 旧 APK 构建缺 headers 字段（T-M16b）：用返回值自带的 contentType 回填
                // content-type 键（非空才填），transport 的 content-type 分支不再整体失效；
                // 新 APK 的 headers 是键名小写全头表，原样透传。
                const headers = result.headers ?? (result.contentType == null ? {} : {'content-type': result.contentType});
                return {status: result.status, headers, bodyText: result.body};
            } catch (err) {
                if (err instanceof NativeSseAbortError) {
                    // 用户取消是终态：AbortError 形态原样上抛，core 的 isAbortLikeError 按 name 识别。
                    // nm-throw: keep — 平台强制（AbortError 原样上抛交 core 识别）
                    throw err;
                }
                const code = (err as {code?: unknown} | null)?.code;
                if (code === 'abort' || cancelState.userAborted) {
                    // native 侧取消回传（requestAbort 后的 reject("abort")）：统一成 AbortError。
                    // nm-throw: keep — 平台强制（AbortError）：native abort 回传统一成 AbortError
                    throw new NativeSseAbortError(requestId);
                }
                if (code === 'invalid') {
                    // nm-throw: keep — 平台强制（Promise 无 Result 通道）：spec Step 6 映射 invalid → protocol/report
                    throw new McpNativeRequestError({kind: 'protocol', action: 'report', detail: err instanceof Error ? err.message : String(err)});
                }
                // network / timeout 及未识别 reject 一律归 network/retry（detail 原文透出，transport 侧不再细分）。
                // nm-throw: keep — 同上
                throw new McpNativeRequestError({kind: 'network', action: 'retry', detail: err instanceof Error ? err.message : String(err)});
            } finally {
                // 本端标记不跨请求泄漏。
                cancelState.userAborted = false;
            }
        };
    },
} as const;
