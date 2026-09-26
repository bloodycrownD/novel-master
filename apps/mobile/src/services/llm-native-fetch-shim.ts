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
 *
 * @module services/llm-native-fetch-shim
 */

import {NativeModules} from 'react-native';
import {
  NativeSseTransportError,
  flattenRequestHeaders,
} from '@novel-master/llm-sse-native';
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

/** native `request` 函数形状（装配层注入，测试 mock 点）。 */
export type LlmNativeRequestFn = LlmSseNativeModule['request'];

/** fetch 形状（与 core `FetchFn` 同构声明，不依赖 DOM lib）。 */
export type FetchLike = typeof globalThis.fetch;

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

/** native request 只带回 Content-Type 一个响应头，headers.get 按需返回。 */
function makeShimResponse(
  status: number,
  contentType: string | null,
  bodyText: string,
): ShimResponse {
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
    json: () => Promise.resolve(JSON.parse(bodyText)),
    // logging 在 !ok 时会 clone().text() 打错误 body——body 文本在手，直接再造一份。
    clone: () => makeShimResponse(status, contentType, bodyText),
  };
}

/**
 * bridge reject（Kotlin `promise.reject(kind, message)` → JS Error，`code`
 * 携带错误分类 "network" | "timeout"）映射为 transport 契约错误形态；
 * 其它错误原样上抛。
 */
function toTransportError(err: unknown): unknown {
  if (err instanceof NativeSseTransportError) {
    return err;
  }
  const code = (err as {code?: unknown} | null)?.code;
  if (code === 'network' || code === 'timeout') {
    return new NativeSseTransportError(
      code,
      err instanceof Error ? err.message : String(err),
      // request 路径没有 requestId 路由（请求-响应一锤子），用固定标签占位。
      'llm-native-fetch',
    );
  }
  return err;
}

/** 提取 fetch 首参的 URL 字符串（string | URL | Request 形态）。 */
function toUrlString(input: Parameters<FetchLike>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/**
 * 以注入的 native `request` 为底座构建 fetch 形状函数（纯适配器，不读全局）。
 *
 * method 分发：按 `init.method` 分发到 native `request(method, ...)`——
 * GET 不传 body（listModels 三家均为 GET）；POST 携带 JSON string body
 * （chatNonStream 走 fetchJson 的请求-响应形态）。native `request` 只收
 * GET/POST（Kotlin 侧按 GET/其余 二分），其余 method 属误用，直接抛错。
 */
export function createNativeRequestFetch(request: LlmNativeRequestFn): FetchLike {
  const fetchLike = async (
    input: Parameters<FetchLike>[0],
    init?: Parameters<FetchLike>[1],
  ): Promise<ShimResponse> => {
    const url = toUrlString(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      throw new Error(
        `llm-native-fetch 仅支持 GET/POST 非流式请求（收到 ${method}）`,
      );
    }
    const rawBody = init?.body;
    let body: string | null = null;
    if (method === 'POST') {
      if (rawBody != null && typeof rawBody !== 'string') {
        // 消费面（fetchJson）只发 JSON string；其它 body 形态属误用，明确报错
        // 而不是静默丢弃或序列化出意外载荷。
        throw new Error(
          `llm-native-fetch 仅支持 string body（收到 ${typeof rawBody}）`,
        );
      }
      body = rawBody ?? null;
    }
    // GET 分支忽略 init.body（与 native/Kotlin GET 语义一致：不携带请求体）。

    let result: NativeRequestResult;
    try {
      result = (await request(
        method,
        url,
        flattenRequestHeaders(init?.headers as Parameters<
          typeof flattenRequestHeaders
        >[0]),
        body,
        LLM_NATIVE_FETCH_CALL_TIMEOUT_MS,
      )) as NativeRequestResult;
    } catch (err) {
      // 网络失败 / callTimeout 到点：reject（与 fetch 的网络错误语义一致）；
      // 非 2xx 不在这里出现——native request 对非 2xx 不 reject，
      // status 与 body 原样带回，由 Response.ok 语义交给消费面 assertOk。
      throw toTransportError(err);
    }
    return makeShimResponse(result.status, result.contentType, result.body);
  };
  // 结构形状已对齐 Response 消费面；ShimResponse → fetch Response 的收口转换。
  return fetchLike as unknown as FetchLike;
}

/** 读取 native request 底座（调用时求值，测试可先 mock NativeModules 再装配）。 */
function getLlmSseNativeRequest(): LlmNativeRequestFn | null {
  const module = NativeModules.LlmSseNative as
    | LlmSseNativeModule
    | undefined;
  if (module == null || typeof module.request !== 'function') {
    return null;
  }
  return module.request.bind(module);
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
  const request = getLlmSseNativeRequest();
  if (request != null) {
    return createNativeRequestFetch(request);
  }
  if (!fallbackWarned) {
    fallbackWarned = true;
    console.warn(
      '[nm-llm] LlmSseNative request 底座不可用，非流式请求回落 globalThis.fetch',
    );
  }
  return globalThis.fetch;
}
