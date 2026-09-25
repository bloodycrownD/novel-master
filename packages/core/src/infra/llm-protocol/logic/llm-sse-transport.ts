/**
 * LLM SSE HTTP transport: registered native transport, fetch stream body, or
 * React Native XMLHttpRequest.
 *
 * 传输三分支逐请求择优（spec llm-stream-native §3）：registered native →
 * XHR → fetch。native transport 经 {@link registerSseTransport} 由 app 装配层
 * 注册（先例：configureLlmFetch / registerOpSqliteDriver），core 不 import
 * 原生包——接口鸭子类型。每次 `postSse` 调用都重新检查注册位（运行时判定，
 * 非进程启动时定死）：native 未注册/加载失败时同进程内自动回落 XHR。
 *
 * fetch 与 XHR 两条路径共享 {@link dispatchSseChunk} 分发语义（A-23）：解码后的
 * chunk 统一经 dispatchSseChunk 转发，首包日志只打一次。pacing 差异仍按传输介质
 * 区分——fetch/native 每个 chunk 直投 onChunk（Desktop/CLI 与 native 合批流的
 * 异步到达天然让步，无需节流），XHR 走 {@link createSseChunkEmitter} 的 32ms
 * 整流（RN burst 平滑）。真正的 SSE 帧解析（data: / \n\n / event 字段）由下游
 * *-sse-parser 经 feedSseLines 增量处理，跨路径一致。详见
 * `.apm/kb/docs/Iterations/mobile-sse-stream-resilience/spec.md`。
 *
 * 黑洞挂死根治（spec llm-stream-timeout 回炉版，三层防御；时序装配自
 * llm-stream-native 起上移到 postSse 公共层，三分支共用同一 watchdog 实例与
 * settle 守卫，分支内只留传输专属清理——XHR abort / fetch controller.abort /
 * native 经 opts.signal 断流）：
 * 1. XHR 路径请求带 `Connection: close`——**条件化**（spec llm-stream-native
 *    §7）：仅当本次请求未走 registered native transport（即运行时判定回落
 *    XHR）时设置。native 管子自带读超时 + callTimeout，黑洞有界，不设 close
 *    以保留连接复用；回落 XHR 时首字黑洞仍由 close + `xhr.timeout` 兜底——
 *    idle watchdog 构造时不武装（缓冲型模型首字不受任何自动超时约束），无
 *    close 头时「高速流后死连接复用」黑洞会以整调用预算形态回归。OkHttp
 *    尊重请求侧 close，连接用完即废不回池；h2 下该头被协议剥离（无害），
 *    由 2 兜底。
 * 2. 整调用兜底 `SSE_WHOLE_CALL_TIMEOUT_MS`：触发机制按分支表达——XHR 经
 *    `xhr.timeout`（RN 0.85.3 映射 OkHttp callTimeout，覆盖 connect/写/读
 *    全周期）；fetch 经公共层 whole-call 定时器 + controller.abort；native
 *    经 transport 内 callTimeout（到点以超时形态错误抛出，本文件按错误形态
 *    识别并映射同一分级）。到点按「是否已收到响应数据」分级——0 字节 =
 *    first-chunk（黑洞，可重试且天然走新连接）；有输出 = idle（不自动重试）。
 * 3. 流空闲安全网 {@link createStreamWatchdog}（仅 idle，无首字臂——缓冲型
 *    模型首字不受任何自动超时约束）。
 *
 * @module infra/llm-protocol/logic/llm-sse-transport
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { FetchFn } from "../ports/adapter.port.js";
import { createSseChunkEmitter } from "./sse-chunk-emitter.js";
import {
  createSseDispatchState,
  dispatchSseChunk,
} from "./dispatch-sse-chunk.js";
import { assertOk } from "./http-util.js";
import {
  createStreamWatchdog,
  STREAM_IDLE_TIMEOUT_MS,
  type StreamWatchdog,
} from "./stream-watchdog.js";
import { LlmStreamTimeoutError } from "./llm-stream-timeout-error.js";

export type SseByteHandler = (chunk: string) => void;

export interface PostSseOptions {
  readonly fetchFn?: FetchFn;
  readonly signal?: AbortSignal;
  readonly logTag?: string;
}

/**
 * SSE 传输 port（spec llm-stream-native §3）：把「发起请求 + 增量投递解码后
 * 文本 chunk」抽象为可注册实现，形状与 `postSse` 现签名逐参对齐。
 *
 * - `post` 语义与 postSse 一致：HTTP 2xx 流结束 resolve `{status, contentType}`；
 *   非 2xx / 网络失败 reject（ProviderError 形态或 transport 自有错误）；
 *   响应数据以 UTF-8 解码后的文本增量经 `onChunk` 投递（只搬字节不认协议，
 *   SSE 帧解析留在 core）。
 * - `init` 为标准 RequestInit（method/headers/body）；`options.fetchFn` 不进
 *   port——port 自带传输。
 * - 超时契约（native callTimeout 到点）：抛出 name 为 `"LlmSseTimeoutError"`
 *   或携带 `kind === "timeout"` 字段的 Error，postSse 公共层识别后映射
 *   {@link LlmStreamTimeoutError} 分级（已收数据 → idle；0 数据 →
 *   first-chunk 可重试）。
 * - abort 语义走 `opts.signal`：signal abort 后 transport 应停止投递并
 *   reject（AbortError 形态或等价）；公共层超时 settle 后同样 abort 该
 *   signal 主动断流（wrapper 侧转发到原生 sseAbort）。用户取消（signal
 *   abort）抛出的错误原样上抛，与 `isRequestAborted` 判据链路兼容。
 */
export interface SseTransport {
  post(
    url: string,
    init: RequestInit,
    onChunk: SseByteHandler,
    opts?: {
      providerId?: string;
      signal?: AbortSignal;
      logTag?: string;
    }
  ): Promise<{ status: number; contentType: string | null }>;
}

let registeredSseTransport: SseTransport | undefined;
let sseTransportOverrideForTests: SseTransport | undefined;

/**
 * 注册/注销 SSE 传输实现（app 装配层调用；mobile 注册 native 管子，
 * desktop/CLI 不注册、零变化）。传 `undefined` 注销——逐请求运行时判定，
 * 注销后同进程内自动回落 XHR/fetch（`Connection: close` 条件化的前提，
 * spec §7）。
 */
export function registerSseTransport(
  transport: SseTransport | undefined
): void {
  registeredSseTransport = transport;
}

/** @internal Test hook: force a fake transport; `undefined` restores. */
export function setSseTransportOverrideForTests(
  transport: SseTransport | undefined
): void {
  sseTransportOverrideForTests = transport;
}

const DEFAULT_LOG_TAG = "[novel-master/llm-sse]";

/**
 * 整调用兜底预算：connect + 写请求体 + 服务端处理 + 读响应体全周期上限。
 * 取值须显著大于最长健康流（200 t/s 下 10 分钟 ≈ 120K token 单次输出）；
 * 触发时按是否已收到数据分级（first-chunk/idle），见类文档注释第 2 条。
 */
export const SSE_WHOLE_CALL_TIMEOUT_MS = 600_000;

/** Minimal XHR surface used by SSE transport (Node types omit DOM lib). */
type SseXmlHttpRequest = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
  responseText: string;
  status: number;
  /** OkHttp callTimeout 毫秒值（RN 0.85.3 起 send 时读取并生效）。 */
  timeout: number;
  onprogress: (() => void) | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  ontimeout: (() => void) | null;
  getResponseHeader(name: string): string | null;
};

type SseXmlHttpRequestConstructor = new () => SseXmlHttpRequest;

function getXmlHttpRequestCtor(): SseXmlHttpRequestConstructor | undefined {
  return (globalThis as { XMLHttpRequest?: SseXmlHttpRequestConstructor })
    .XMLHttpRequest;
}

let cachedShouldUseXhr: boolean | undefined;
/** @internal Test hook to force or clear transport selection. */
let shouldUseXhrOverrideForTests: boolean | undefined;

/** @internal Reset cached RN detection and transport test overrides. */
export function resetShouldUseXhrForSseCacheForTests(): void {
  cachedShouldUseXhr = undefined;
  shouldUseXhrOverrideForTests = undefined;
  sseTransportOverrideForTests = undefined;
}

/** @internal Force XHR/fetch branch in tests. */
export function setShouldUseXhrForSseOverrideForTests(
  value: boolean | undefined
): void {
  shouldUseXhrOverrideForTests = value;
  cachedShouldUseXhr = undefined;
}

/**
 * True on React Native where fetch streaming bodies are unavailable.
 * Result is cached for the process lifetime.
 */
export function shouldUseXhrForSse(): boolean {
  if (shouldUseXhrOverrideForTests !== undefined) {
    return shouldUseXhrOverrideForTests;
  }
  if (cachedShouldUseXhr !== undefined) {
    return cachedShouldUseXhr;
  }
  // RN exposes XMLHttpRequest and sets navigator.product; Node/CLI do not.
  cachedShouldUseXhr =
    getXmlHttpRequestCtor() != null &&
    (globalThis as { navigator?: { product?: string } }).navigator?.product ===
      "ReactNative";
  return cachedShouldUseXhr;
}

function isSseDebugEnabled(): boolean {
  if (process.env.NM_DEBUG_LLM_FETCH === "1") {
    return true;
  }
  const g = globalThis as {
    __NM_DEBUG_LLM_FETCH__?: boolean;
    __DEV__?: boolean;
  };
  return g.__NM_DEBUG_LLM_FETCH__ === true || g.__DEV__ === true;
}

function applyXhrHeaders(
  xhr: SseXmlHttpRequest,
  headers: RequestInit["headers"] | undefined
): void {
  if (headers == null) {
    return;
  }
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });
    return;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      xhr.setRequestHeader(key, value);
    }
    return;
  }
  for (const [key, value] of Object.entries(headers)) {
    xhr.setRequestHeader(key, String(value));
  }
}

function logSse(
  logTag: string,
  message: string,
  detail?: Record<string, unknown>
): void {
  if (!isSseDebugEnabled()) {
    return;
  }
  if (detail != null) {
    console.log(logTag, message, detail);
  } else {
    console.log(logTag, message);
  }
}

/**
 * transport 超时错误识别（鸭子类型，core 不 import 原生包）：native 侧
 * LlmSseError(kind:"timeout") 经 wrapper 转成 name 为 `"LlmSseTimeoutError"`
 * 或携带 `kind === "timeout"` 字段的 Error（契约见 {@link SseTransport}）。
 */
function isTransportTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const e = error as { name?: unknown; kind?: unknown };
  return e.name === "LlmSseTimeoutError" || e.kind === "timeout";
}

/**
 * POST and deliver SSE text chunks incrementally (UTF-8 decoded strings).
 * HTTP 4xx/5xx throw {@link ProviderError} with code `HTTP_ERROR`.
 *
 * 传输三分支逐请求择优（registered native → XHR → fetch）；watchdog、
 * whole-call 语义与 settle 守卫在公共层装配（见模块文档）。
 */
export function postSse(
  url: string,
  init: RequestInit,
  onChunk: SseByteHandler,
  providerId?: string,
  options?: PostSseOptions
): Promise<{ status: number; contentType: string | null }> {
  const logTag = options?.logTag ?? DEFAULT_LOG_TAG;
  const signal = options?.signal ?? init.signal ?? undefined;
  const method = init.method ?? "POST";

  // 三分支逐请求运行时判定（spec §3）：registered native → XHR → fetch。
  // 测试强制位优先于真实注册位；native 未注册时同进程自动回落 XHR。
  const transport = sseTransportOverrideForTests ?? registeredSseTransport;
  const usedRegisteredTransport = transport != null;
  const kind: "native" | "xhr" | "fetch" = usedRegisteredTransport
    ? "native"
    : shouldUseXhrForSse()
      ? "xhr"
      : "fetch";

  logSse(logTag, "→", { method, url, transport: kind });

  return new Promise((resolve, reject) => {
    // ===== 公共层（watchdog / whole-call / settle 守卫上移，三分支共用）=====
    let settled = false;
    let processedLength = 0;
    let lastActivityAt = Date.now();
    // 观测打点：当前待发缓冲长度（XHR 分支注册 emitter 口径；fetch/native
    // 即时转发无节流缓冲，保持默认记 0）。
    let bufferedBytesNow = (): number => 0;
    // 分支注册的断流钩子（超时 settle 后主动断流）：XHR 为 xhr.abort；fetch
    // 与 native 为 controller.abort（native 经 opts.signal 由 wrapper 转发
    // 到原生 sseAbort）。
    let abortStream: (() => void) | undefined;
    // 分支注册的终态清理钩子（XHR 的 emitter.dispose 等，幂等）。
    let cleanupBranch: (() => void) | undefined;
    // whole-call JS 定时器（仅 fetch 分支启用；XHR 用原生 xhr.timeout、
    // native 用 transport 内 callTimeout，避免双触发竞态）。
    let wholeCallTimer: ReturnType<typeof setTimeout> | null = null;

    const clearWholeCallTimer = (): void => {
      if (wholeCallTimer != null) {
        clearTimeout(wholeCallTimer);
        wholeCallTimer = null;
      }
    };

    const resolveOnce = (value: {
      status: number;
      contentType: string | null;
    }) => {
      if (settled) return;
      settled = true;
      clearWholeCallTimer();
      resolve(value);
    };
    // 放宽为 Error：watchdog 超时要以此 settle LlmStreamTimeoutError（非 ProviderError）。
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearWholeCallTimer();
      reject(error);
    };

    // 空闲看门狗（仅 idle，无首字臂——回炉版 spec 第 3 节）：
    // onTimeout 时序关键——先 rejectOnce(超时错误) 抢占 settle，再经
    // abortStream/cleanupBranch 断流清理。abort 触发的迟到回调（XHR onabort /
    // fetch AbortError / native transport 错误）中的二次 settle 被 settled
    // 守卫挡掉，超时错误原样上抛；若反过来寄望 abort 链传播，会被
    // isRequestAborted 识别为用户取消、被 adapter 吞成 partial，分级语义全失效。
    const watchdog: StreamWatchdog = createStreamWatchdog({
      onTimeout: () => {
        const phase = processedLength > 0 ? "idle" : "first-chunk";
        logSse(logTag, "stream timeout", {
          phase,
          lastActivityAt,
          processedLength,
          bufferedBytes: bufferedBytesNow(),
        });
        rejectOnce(new LlmStreamTimeoutError(phase, STREAM_IDLE_TIMEOUT_MS));
        watchdog.dispose();
        abortStream?.();
        cleanupBranch?.();
      },
    });

    /** 响应数据到达（含空增量/解码滞后的增量）：`bytes` 为本次解码后新增字符数。 */
    const noteActivity = (bytes: number): void => {
      lastActivityAt = Date.now();
      processedLength += bytes;
      watchdog.noteActivity();
    };

    /**
     * 整调用兜底公共语义（回炉版 spec 第 2 节）：到点按「是否已收到响应数据」
     * 分级——黑洞 0 字节 → first-chunk（可重试，Connection: close 保证重试走
     * 新连接）；健康长流超预算（有输出）→ idle（不自动重试，走失败链）。
     * 触发机制按分支表达：XHR `xhr.timeout` 到点回调 / fetch whole-call
     * 定时器 / native transport 超时错误映射（detail 区分来源）。
     */
    const handleWholeCallTimeout = (detail?: string): void => {
      if (settled) {
        // 迟到的触发与其它 settle 来源竞态：丢弃。
        return;
      }
      const phase = processedLength > 0 ? "idle" : "first-chunk";
      logSse(logTag, "stream timeout", {
        phase,
        source: detail ?? "whole-call",
        lastActivityAt,
        processedLength,
        bufferedBytes: bufferedBytesNow(),
      });
      rejectOnce(
        new LlmStreamTimeoutError(
          phase,
          SSE_WHOLE_CALL_TIMEOUT_MS,
          detail ?? "whole-call budget"
        )
      );
      watchdog.dispose();
      abortStream?.();
      cleanupBranch?.();
    };

    /** 仅 fetch 分支启用：whole-call 预算的 JS 定时器表达。 */
    const armWholeCallTimer = (): void => {
      wholeCallTimer = setTimeout(() => {
        wholeCallTimer = null;
        handleWholeCallTimeout();
      }, SSE_WHOLE_CALL_TIMEOUT_MS);
    };

    // ===== 分支执行（分支内只保留传输专属清理）=====

    /**
     * native 分支：registered transport 承载传输（合批后的 chunk 事件由
     * wrapper 转成 onChunk 调用）。watchdog/whole-call 语义全在公共层：
     * callTimeout 由 transport 内部承接（超时按契约形态抛错），公共层
     * 不再开 JS 定时器避免双触发竞态。
     */
    const runNative = (t: SseTransport): void => {
      // abort 语义走 opts.signal（与 fetch 分支同构）：用户 signal（停止
      // 生成）与公共层超时断流共用一个组合 controller，wrapper 侧监听并
      // 转发到原生 sseAbort。用户取消抛 AbortError 形态原样上抛，
      // isRequestAborted 判据链路保持兼容。
      const controller = new AbortController();
      if (signal != null) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener(
            "abort",
            () => {
              controller.abort();
            },
            { once: true }
          );
        }
      }
      abortStream = () => controller.abort();

      const dispatchState = createSseDispatchState();
      const transportOnChunk: SseByteHandler = (chunk) => {
        noteActivity(chunk.length);
        // native 侧已合批（~10 事件/s），JS 侧直投（与 fetch 同款即时转发）。
        dispatchSseChunk(chunk, dispatchState, onChunk, (bytes) =>
          logSse(logTag, "native first chunk", { bytes })
        );
      };

      void t
        .post(url, init, transportOnChunk, {
          providerId,
          signal: controller.signal,
          logTag,
        })
        .then(
          (result) => {
            watchdog.dispose();
            resolveOnce(result);
          },
          (error: unknown) => {
            if (settled) {
              // 公共层已以超时错误 settle：断流导致的迟到错误在此丢弃，
              // 不让它顶替/竞态超时错误。
              return;
            }
            if (isTransportTimeoutError(error)) {
              // native 读超时/callTimeout 到点：映射同一分级语义（spec §3，T-N2）。
              // detail 透传 wrapper 错误的真实信息（如 "read timeout after 30000ms"），
              // 固定文案会把 30s 读超时误标成 callTimeout 来源。
              handleWholeCallTimeout(
                `native timeout: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return;
            }
            watchdog.dispose();
            rejectOnce(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        );
    };

    /** XHR 分支：RN 上 fetch 无流式 body 时的主力路径（无 native 注册时）。 */
    const runXhr = (): void => {
      const XhrCtor = getXmlHttpRequestCtor();
      if (XhrCtor == null) {
        rejectOnce(
          new ProviderError(
            "HTTP_ERROR",
            "XMLHttpRequest is not available in this environment",
            { providerId }
          )
        );
        return;
      }

      const xhr = new XhrCtor();
      const dispatchState = createSseDispatchState();
      const emitter = createSseChunkEmitter(onChunk);

      bufferedBytesNow = () => emitter.bufferedLength();
      abortStream = () => xhr.abort();
      cleanupBranch = () => emitter.dispose();

      // 已从 responseText 消费的长度（slice 游标）。
      let xhrCursor = 0;

      const deliverNewText = (): void => {
        const text = xhr.responseText;
        if (text.length <= xhrCursor) {
          return;
        }
        const chunk = text.slice(xhrCursor);
        xhrCursor = text.length;
        noteActivity(chunk.length);
        // 经公共 dispatchSseChunk 转发到 emitter（节流由 emitter 负责），首包日志统一在此。
        dispatchSseChunk(
          chunk,
          dispatchState,
          (text) => emitter.append(text),
          (bytes) => logSse(logTag, "xhr first chunk", { bytes })
        );
      };

      xhr.open(init.method ?? "POST", url);
      // 整调用兜底（回炉版 spec 第 2 节）：RN 0.85.3 将 xhr.timeout 映射为
      // OkHttp callTimeout（克隆 builder，共享池/分发器），覆盖 connect/写/读
      // 全周期——死连接黑洞（四超时全 0 下读永久阻塞）的唯一确定性下界。
      // 到点回调走公共层 handleWholeCallTimeout 统一分级。
      xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS;

      if (signal != null) {
        if (signal.aborted) {
          emitter.dispose();
          watchdog.dispose();
          rejectOnce(
            new ProviderError("HTTP_ERROR", "Request aborted", { providerId })
          );
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            xhr.abort();
          },
          { once: true }
        );
      }

      xhr.onprogress = () => {
        // 任何响应数据到达（含 UTF-8 解码滞后的空增量）：重置空闲 deadline。
        noteActivity(0);
        deliverNewText();
      };

      // 整调用预算耗尽（callTimeout 到点，RN dispatch 'timeout' 事件）：
      // 分级与 settle 语义在公共层 handleWholeCallTimeout；rejectOnce 抢占
      // settle 后，RN 后续可能补发的 load/error/abort 回调被 settled 守卫丢弃。
      xhr.ontimeout = () => {
        handleWholeCallTimeout();
      };

      xhr.onload = () => {
        watchdog.dispose();
        deliverNewText();
        // Synchronous flush on complete: no async drain chain; guarantees tail delivery.
        const tail = emitter.flush();
        if (tail.length > 0) {
          onChunk(tail);
        }

        const status = xhr.status;
        const contentType = xhr.getResponseHeader("Content-Type");
        logSse(logTag, "xhr complete", { status, contentType });

        if (status < 200 || status >= 300) {
          const body = xhr.responseText;
          const snippet = body.length > 500 ? `${body.slice(0, 500)}…` : body;
          rejectOnce(
            new ProviderError("HTTP_ERROR", `HTTP ${status}: ${snippet}`, {
              providerId,
            })
          );
          return;
        }

        resolveOnce({ status, contentType });
      };

      xhr.onerror = () => {
        watchdog.dispose();
        emitter.dispose();
        rejectOnce(
          new ProviderError("HTTP_ERROR", "XHR network error", { providerId })
        );
      };

      xhr.onabort = () => {
        watchdog.dispose();
        emitter.dispose();
        rejectOnce(
          new ProviderError("HTTP_ERROR", "Request aborted", { providerId })
        );
      };

      applyXhrHeaders(xhr, init.headers);
      // 防死连接复用（回炉版 spec 第 1 节；llm-stream-native §7 条件化）：
      // 置于 applyXhrHeaders 之后 = 覆盖用户 provider.headers 的同名头，强制
      // 生效。OkHttp 尊重请求侧 Connection: close（CallServerInterceptor →
      // noNewExchangesOnConnection），连接用完即废不回池——「上一次流留下的
      // （可能已静默死亡的）连接」不再被下一次请求复用。h2 下该头被协议剥离
      // （无害），黑洞由 xhr.timeout 兜底。
      // 条件化：仅当本次请求未走 registered native transport 时设置——进入
      // XHR 分支即意味着运行时判定回落（当前该条件恒真，显式表达 spec §7
      // 语义：native 分支不设 close 以保留连接复用，回落 XHR 保留兜底）。
      if (!usedRegisteredTransport) {
        xhr.setRequestHeader("Connection", "close");
      }
      xhr.send(init.body ?? null);
    };

    /** fetch 分支：Desktop/CLI（流式 body 可用）与未注册 native 的非 RN 环境。 */
    const runFetch = (): void => {
      const fetchFn = options?.fetchFn ?? globalThis.fetch;

      // 组合自有 controller：用户 AbortSignal（停止生成）转发进来；公共层
      // 超时也经它主动断流。用户取消语义不变——signal abort →
      // controller.abort → fetch/reader 抛 AbortError → 上抛（与直接传
      // signal 等价）。
      const controller = new AbortController();
      if (signal != null) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener(
            "abort",
            () => {
              controller.abort();
            },
            { once: true }
          );
        }
      }
      abortStream = () => controller.abort();

      const dispatchState = createSseDispatchState();

      // 整调用兜底（与 XHR 的 xhr.timeout 语义对齐，回炉版 spec 第 2 节）：
      // connect/写/读全周期预算，到点经公共层 handleWholeCallTimeout 分级收敛。
      armWholeCallTimer();

      void (async () => {
        try {
          const response = await fetchFn(url, {
            ...init,
            signal: controller.signal,
          });
          await assertOk(response, providerId);

          if (response.body == null) {
            const contentType = response.headers.get("content-type") ?? "none";
            throw new ProviderError(
              "HTTP_ERROR",
              `Empty streaming response body (HTTP ${response.status}, content-type: ${contentType}). This environment does not support fetch stream bodies.`,
              { providerId }
            );
          }

          logSse(logTag, "fetch stream start", {
            status: response.status,
            contentType: response.headers.get("content-type"),
          });

          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            // fetch 在此完成 UTF-8 解码，再经公共 dispatchSseChunk 直投
            // onChunk（即时转发，无节流）；首包日志与 XHR 路径共用同一套
            // 分发语义。noteActivity 同时覆盖「read() 返回即活动」语义
            //（空 chunk 解码为空串，bytes 记 0 仍重置空闲 deadline）。
            const chunk = decoder.decode(value, { stream: true });
            noteActivity(chunk.length);
            dispatchSseChunk(chunk, dispatchState, onChunk, (bytes) =>
              logSse(logTag, "fetch first chunk", { bytes })
            );
          }

          watchdog.dispose();
          resolveOnce({
            status: response.status,
            contentType: response.headers.get("content-type"),
          });
        } catch (error) {
          watchdog.dispose();
          if (settled) {
            // 公共层已以超时错误 settle：controller.abort() 导致的 AbortError
            // 在此丢弃，不让它顶替/竞态超时错误。
            return;
          }
          rejectOnce(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      })();
    };

    if (transport != null) {
      runNative(transport);
    } else if (kind === "xhr") {
      runXhr();
    } else {
      runFetch();
    }
  });
}
