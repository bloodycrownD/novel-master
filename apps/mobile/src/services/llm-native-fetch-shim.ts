/**
 * 非流式 LLM 请求的 fetch shim：以 llm-sse-native 的 `request`（请求-响应
 * 形态）为底座实现标准 fetch 形状，经 `configureLlmFetch` 注入后让
 * `listModels` / `chatNonStream` 等一切非流式调用零改动获得整调用
 * callTimeout 与 native 连接池（spec llm-stream-native §4 非流式收编）。
 *
 * 边界（与 spec §4 对齐）：
 * - 只承载非流式请求-响应；返回的 Response 不提供 body 流（body 置 null）。
 *   一旦被流式消费误用（postSse 的 fetch 分支取 body 流），会命中 core 既有
 *   的「Empty streaming response body」防御抛明确 ProviderError，不静默挂起。
 * - 本模块是纯传输适配，零日志组合逻辑；dev 日志由装配层
 *   `createLoggingFetch(shim)` 在最外层统一包装（setup-llm-fetch.ts）。
 * - 取消：读 `init.signal`——已取消立刻以 AbortError 拒绝（native 请求不发出）；
 *   请求途中取消先调 native `requestAbort(requestId)`（OkHttp `Call.cancel()`
 *   真断连），再本地立刻 reject，不等 native 返回。旧 native 构建缺
 *   `requestAbort` 时退化为「仅本地取消」——对外行为一致（停止按钮立刻生效），
 *   只是底层连接跑到 callTimeout。
 *
 * @module services/llm-native-fetch-shim
 */

import {NativeModules} from 'react-native';
import {NativeSseAbortError, NativeSseTransportError, flattenRequestHeaders} from '@novel-master/llm-sse-native';
import type {LlmSseNativeModule} from '@novel-master/llm-sse-native/native';

/**
 * shim 层整调用超时（毫秒）。
 *
 * 取值对齐管子默认（llm-sse-native `LLM_SSE_DEFAULT_CALL_TIMEOUT_MS`）与
 * core 流式整调用兜底 `SSE_WHOLE_CALL_TIMEOUT_MS` 的 600s——connect + 写
 * 请求体 + 服务端处理 + 读响应体全周期预算，非流式请求不再无限黑洞；
 * 正常 listModels / chatNonStream（含长思考回复）远小于该预算。
 */
export const LLM_NATIVE_FETCH_CALL_TIMEOUT_MS = 600_000;

/**
 * 非流式 requestId 的实例前缀（6 位 base36）：形态同 transport，但计数器独立维护。
 *
 * 与流式 transport 的 `llm-sse-*` 是不同命名空间：模块重载（计数器归 1）时
 * 旧实例发起的请求在 native 侧可能仍存活，前缀不同才不会撞 id 被
 * `reject("invalid")` 打掉。transport 的前缀/计数器是模块私有，这里不共享。
 */
const NATIVE_FETCH_REQUEST_ID_PREFIX = Math.random().toString(36).slice(2, 8).padEnd(6, '0');

let nextNativeFetchRequestId = 1;

/** native `request` 函数形状（装配层注入，测试 mock 点）。 */
export type LlmNativeRequestFn = LlmSseNativeModule['request'];
/** native `requestAbort` 函数形状（真断连入口，同样注入）。 */
type LlmNativeRequestAbortFn = LlmSseNativeModule['requestAbort'];

/** shim 的 native 依赖（双注入：不直连 NativeModules，保持纯适配器设计）。 */
interface LlmNativeRequestDeps {
  readonly request: LlmNativeRequestFn;
  /** 旧 native 构建缺该方法时退化为「仅本地取消」的假取消。 */
  readonly requestAbort?: LlmNativeRequestAbortFn;
}

/** fetch 形状（与 core `FetchFn` 同构声明，不依赖 DOM lib）。 */
type FetchLike = typeof globalThis.fetch;

/** native 侧 request 的 resolve 形状。 */
interface NativeRequestResult {
  status: number;
  contentType: string | null;
  body: string;
}

/** shim Response 的最小消费面（fetchJson / logging / 流式误用防御够用）。 */
interface ShimResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly statusText: string;
  readonly headers: {get(name: string): string | null};
  /** 恒为 null：不承载流式（误用即命中 core Empty body 防御，见模块注释）。 */
  readonly body: null;
  text(): Promise<string>;
  json(): Promise<unknown>;
  clone(): ShimResponse;
}

/**
 * nm-style: keep-local — 自引用工厂：`clone()` 需要递归重建同形响应，内联会丢失自引用。
 * native request 只带回 Content-Type 一个响应头，headers.get 按需返回。
 */
function makeShimResponse(status: number, contentType: string | null, bodyText: string): ShimResponse {
  const headers = {
    get(name: string): string | null {
      return name.toLowerCase() === 'content-type' ? contentType : null;
    },
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: '',
    headers,
    body: null,
    text: () => Promise.resolve(bodyText),
    // async 形状对齐 fetch Response 契约：JSON.parse 失败时返回 rejected
    // Promise，而不是同步 throw（调用方按 Promise reject 捕才捕得到）。
    json: async () => JSON.parse(bodyText),
    // logging 在 !ok 时会 clone().text() 打错误 body——body 文本在手，直接再造一份。
    clone: () => makeShimResponse(status, contentType, bodyText),
  };
}

/**
 * 让 native 调用与 `signal` 的 abort 事件赛跑：abort 先到就先真断连
 * （`requestAbort(requestId)` → OkHttp `Call.cancel()`），再以 AbortError
 * 立刻 settle；`cancelState.userAborted` 供调用方把 native 的 `"abort"`
 * reject 同归 AbortError。
 *
 * 两侧 settle 幂等：native 的迟到结果（成功或 `code:"abort"` 的失败）被
 * `settled` 吞掉——不二次 settle、不产生未处理的 rejection。监听器 settle 后
 * 摘除（`once` 命中即摘，未命中在 native settle 时手动摘）。
 *
 * nm-style: keep-local — 取消赛跑协议：`settled` 双分支状态机 + once listener 摘除是独立不变量，内联会把竞态收口塞进 fetch 主体。
 */
function raceWithAbort<T>(call: Promise<T>, signal: AbortSignal, requestId: string, requestAbort: LlmNativeRequestAbortFn | undefined, cancelState: {userAborted: boolean}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cancelState.userAborted = true;
      // 先真断连再本地 settle；requestAbort 抛错（旧构建/桥已关停）不阻塞取消。
      try {
        requestAbort?.(requestId);
      } catch {
        // 退化为仅本地取消：请求结果被丢弃，连接跑到 callTimeout。
      }
      reject(new NativeSseAbortError(requestId));
    };
    const settle = (): boolean => {
      if (settled) {
        return false;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      return true;
    };
    // 先挂 native 两侧处理再判 aborted：已取消时直接 reject，也不会让 native
    // 迟到 rejection 变成未处理（Promise 的 handler 已就位）。
    call.then(
      value => {
        if (settle()) {
          resolve(value);
        }
      },
      (err: unknown) => {
        if (settle()) {
          reject(err);
        }
      },
    );
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, {once: true});
  });
}

/**
 * 以注入的 native `request` / `requestAbort` 为底座构建 fetch 形状函数（纯适配器，不读全局）。
 *
 * method 分发：按 `init.method` 分发到 native `request(requestId, method, ...)`——
 * GET 不传 body（listModels 三家均为 GET）；POST 携带 JSON string body
 * （chatNonStream 走 fetchJson 的请求-响应形态）。native `request` 只收
 * GET/POST（Kotlin 侧按 GET/其余 二分），其余 method 属误用，直接抛错。
 *
 * 取消：`init.signal` 已 aborted 时直接拒绝（native 请求不发出）；请求途中
 * abort 先调 `requestAbort(requestId)` 真断连，再立刻以 AbortError 拒绝。
 */
export function createNativeRequestFetch(deps: LlmNativeRequestDeps): FetchLike {
  const {request, requestAbort} = deps;
  const fetchLike = async (input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]): Promise<ShimResponse> => {
    const signal = init?.signal ?? undefined;
    // 本次请求的取消路由键（实例前缀 + 独立计数器）：abort 时用它调 requestAbort。
    const requestId = `llm-native-fetch-${NATIVE_FETCH_REQUEST_ID_PREFIX}-${nextNativeFetchRequestId++}`;
    if (signal?.aborted === true) {
      // fetch 语义：aborted signal 立即以 AbortError 拒绝；native 请求不发出。
      throw new NativeSseAbortError(requestId);
    }
    // 提取 fetch 首参的 URL 字符串（string | URL | Request 形态）。
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      // nm-throw: keep — native bridge fetch 适配层：fetch 形状契约以 reject 报错（测试钉 'GET/POST' 拒绝）
      throw new Error(`llm-native-fetch 仅支持 GET/POST 非流式请求（收到 ${method}）`);
    }
    const rawBody = init?.body;
    let body: string | null = null;
    if (method === 'POST') {
      if (rawBody != null && typeof rawBody !== 'string') {
        // 消费面（fetchJson）只发 JSON string；其它 body 形态属误用，明确报错
        // 而不是静默丢弃或序列化出意外载荷。
        // nm-throw: keep — native bridge fetch 适配层：fetch 形状契约以 reject 报错
        throw new Error(`llm-native-fetch 仅支持 string body（收到 ${typeof rawBody}）`);
      }
      body = rawBody ?? null;
    }
    // GET 分支忽略 init.body（与 native/Kotlin GET 语义一致：不携带请求体）。

    // 本地取消标记：race 的 abort 分支置位；native 的 "abort" reject 据此与本端
    // 主动取消同归 AbortError（而非网络失败）。只服务本次调用，finally 清理。
    const cancelState = {userAborted: false};
    let result: NativeRequestResult;
    try {
      const headers = flattenRequestHeaders(init?.headers as Parameters<typeof flattenRequestHeaders>[0]);
      const nativeCall = request(requestId, method, url, headers, body, LLM_NATIVE_FETCH_CALL_TIMEOUT_MS) as Promise<NativeRequestResult>;
      result = signal == null ? await nativeCall : await raceWithAbort(nativeCall, signal, requestId, requestAbort, cancelState);
    } catch (err) {
      if (err instanceof NativeSseAbortError) {
        // 用户取消是终态：AbortError 形态原样上抛，不套传输错误映射——core 的
        // isAbortLikeError / isRequestAborted 按 name 识别。
        throw err;
      }
      // 网络失败 / callTimeout 到点：reject（与 fetch 的网络错误语义一致）；
      // 非 2xx 不在这里出现——native request 对非 2xx 不 reject，
      // status 与 body 原样带回，由 Response.ok 语义交给消费面 assertOk。
      // bridge reject（Kotlin `promise.reject(kind, message)` → JS Error，`code`
      // 携带错误分类 "network" | "timeout" | "abort"）映射为 transport 契约错误形态；
      // 其它错误原样上抛。
      if (err instanceof NativeSseTransportError) {
        throw err;
      }
      const code = (err as {code?: unknown} | null)?.code;
      if (code === 'abort' || cancelState.userAborted) {
        // native 侧取消回传（requestAbort 后的 reject("abort")）：统一成
        // AbortError，不当网络错误弹给用户。
        throw new NativeSseAbortError(requestId);
      }
      if (code === 'network' || code === 'timeout') {
        throw new NativeSseTransportError(code, err instanceof Error ? err.message : String(err), requestId);
      }
      throw err;
    } finally {
      // 迟到 settle 已在 race 内吞掉；本端标记不跨请求泄漏。
      cancelState.userAborted = false;
    }
    return makeShimResponse(result.status, result.contentType, result.body);
  };
  // 结构形状已对齐 Response 消费面；ShimResponse → fetch Response 的收口转换。
  return fetchLike as unknown as FetchLike;
}

let fallbackWarned = false;

/**
 * 装配工厂：native request 可用（Android 且已 autolink）→ 以它为底座的
 * fetch shim；不可用（iOS 工程 / Jest 环境）→ 回落 `globalThis.fetch`——
 * 发布面仅 Android，iOS 只是开发调试面，缺 native 不应炸掉全部非流式请求。
 *
 * 回落是传输底座选择，不是日志组合：装配层无条件把本工厂产物注册进
 * `configureLlmFetch`（生产/开发统一），__DEV__ 的 logging 仍在最外层。
 */
export function createMobileLlmFetch(): FetchLike {
  // 读取 native request 底座（调用时求值，测试可先 mock NativeModules 再装配）。
  const module = NativeModules.LlmSseNative as LlmSseNativeModule | undefined;
  const request = module == null || typeof module.request !== 'function' ? null : module.request.bind(module);
  // requestAbort 缺失（旧 native 构建）不阻塞装配：退化为仅本地取消，仍保留
  // native 连接池与整调用 callTimeout，比回落 globalThis.fetch 更接近生产行为。
  const requestAbort = module == null || typeof module.requestAbort !== 'function' ? null : module.requestAbort.bind(module);
  if (request != null) {
    return createNativeRequestFetch(requestAbort == null ? {request} : {request, requestAbort});
  }
  if (!fallbackWarned) {
    fallbackWarned = true;
    console.warn('[nm-llm] LlmSseNative request 底座不可用，非流式请求回落 globalThis.fetch');
  }
  return globalThis.fetch;
}
