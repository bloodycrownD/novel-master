/**
 * `curl` 工具实现：对 http/https URL 发起完整 HTTP 请求（GET/POST/PUT/
 * PATCH/DELETE/HEAD/OPTIONS），支持自定义请求头与请求体，回流状态码、
 * 内容类型与响应正文，让 agent 具备对齐 curl 定位的联网能力。
 *
 * 设计口径（SPEC fetch-tool + curl 升级偏离记录）：
 * - 双端同一份实现：走 `globalThis.fetch` + 非流式 `response.text()`，
 *   无平台分支；网络入口经 `ctx.fetchFn` 可选注入（缺省 globalThis.fetch）。
 * - 超时用 `AbortController` + 手动 `setTimeout`（不用 `AbortSignal.timeout`，
 *   规避 RN/Hermes 兼容差异）。计时器覆盖 fetch + 正文读取（`text()`）
 *   全程——慢滴流 body 若在响应头到达后失去超时兜底，会让整个回合
 *   无限挂起；请求整体结束（无论成功或失败）后才 `clearTimeout`。
 *   超时秒数由入参 timeout 驱动（默认 30，上限 120）。
 * - HTTP 非 2xx 不算错误（4xx/5xx 也是有效响应，让模型自行解释），
 *   与 LLM provider 层的 `assertOk` 语义刻意不同。
 * - content-length 预检：响应头声明超过 {@link CURL_MAX_RESPONSE_BYTES}
 *   时不读 body，直接返回占位输出，防巨响应内存峰值。
 * - 截断按字节预算（{@link CURL_MAX_BODY_BYTES}）而非行数：网页 HTML
 *   常是单行几十万字符，按行截断（`capUtf8Bytes`）会一行都留不下。
 * - 请求体 content-type：headers 显式给就用显式的；有 body 且未显式
 *   给 content-type 时默认 application/json（API 提交的常见口径）。
 * - 不做确认门 / 域名白名单 / SSRF 私网拦截（用户拍板：简单搞、参考
 *   curl；协议白名单之外的限制列为 known limitation，见 spec 偏离记录）。
 *
 * @module domain/tool/builtin/curl-tool
 */

import { z } from "zod";

import { toolFailed } from "@/errors/tool-errors.js";
import type { Tool } from "../model/tool.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";

/** 支持的 HTTP 方法（对齐 curl 常用子集，method 入参枚举来源）。 */
const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

/** 默认超时（秒）：入参 timeout 缺省值，到期 abort 返回可读 ToolError。 */
export const CURL_DEFAULT_TIMEOUT_SECONDS = 30;

/** 超时上限（秒）：入参 timeout 的 schema 层硬顶。 */
export const CURL_MAX_TIMEOUT_SECONDS = 120;

/** 回流正文的字节预算：截断点按 UTF-8 字节计，末尾标注行不计入。 */
export const CURL_MAX_BODY_BYTES = 256 * 1024;

/** content-length 预检上限：响应头声明超过此值时不读 body。 */
export const CURL_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** 自定义请求头条数上限。 */
export const CURL_MAX_HEADERS = 16;

/**
 * header 名合法字符集：字母 / 数字 / 连字符 / 下划线，长度 1-64。
 * 禁止空格、冒号、CR/LF 等字符——header 名或值一旦混入 CRLF，
 * 会被底层按行切割成新 header（CRLF 注入），这里在 schema 层拒绝。
 */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 单条 header 值的字节上限。 */
export const CURL_MAX_HEADER_VALUE_BYTES = 8 * 1024;

/** 请求体入参的字节上限（schema 层拒绝，超限不发请求）。 */
export const CURL_MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** `curl` 工具输入。 */
export interface CurlToolInput {
  /** 目标 URL，仅支持 http/https 协议（schema 层白名单校验）。 */
  readonly url: string;
  /** HTTP 方法，默认 GET。 */
  readonly method?: (typeof HTTP_METHODS)[number];
  /** 自定义请求头（最多 16 条；名称防 CRLF 注入；单条值上限 8KB）。 */
  readonly headers?: Readonly<Record<string, string>>;
  /** 请求体（上限 1MB；GET/HEAD 不携带请求体）。 */
  readonly body?: string;
  /** 超时秒数，默认 30，上限 120。 */
  readonly timeout?: number;
}

/** `curl` 工具输出。 */
export interface CurlToolOutput {
  /** 规范化后的请求 URL。 */
  readonly url: string;
  /** 重定向后的最终 URL（response.url）；与请求 URL 相同时仍回填。 */
  readonly finalUrl: string;
  /** 实际使用的 HTTP 方法（回显入参，缺省 GET）。 */
  readonly method: string;
  readonly status: number;
  /** response.headers.get("content-type") ?? ""；缺省按空串返回。 */
  readonly contentType: string;
  /** 截断后的正文文本；非文本 Content-Type 时为占位说明。 */
  readonly body: string;
  /** 正文是否被截断（字节预算或 content-length 预检触发）。 */
  readonly truncated: boolean;
  /**
   * 原始正文字节数，三来源：
   * - 文本路径：读 body 后按块增量累计 UTF-8 字节数（解码后口径，
   *   非线上压缩传输字节数）；
   * - content-length 预检路径：不读 body，回填 content-length 头数值；
   * - 非文本路径：不下载正文，回填 content-length 头数值（缺失时为 0）。
   */
  readonly originalBytes: number;
}

/**
 * 解析 content-length 头：缺失或非法（非数字 / 负数等）时返回 null。
 * 预检与非文本占位两处共用，避免各自直读原始头。
 */
function parseContentLength(response: Response): number | null {
  const header = response.headers.get("content-length");
  if (header == null) return null;
  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 判断 Content-Type 是否按文本处理：主类型 `text/`，或 subtype含
 * json / xml / javascript / svg / yaml / urlencoded 关键字。
 * 缺省（空串）按文本处理。
 */
function isTextualContentType(contentType: string): boolean {
  if (contentType.length === 0) return true;
  const lower = contentType.toLowerCase();
  if (lower.startsWith("text/")) return true;
  return (
    lower.includes("json") ||
    lower.includes("xml") ||
    lower.includes("javascript") ||
    lower.includes("svg") ||
    lower.includes("yaml") ||
    lower.includes("urlencoded")
  );
}

/**
 * fetch / text() 两个阶段的错误统一映射：超时 abort 给可读超时文案
 * （含 URL 与实际超时毫秒数），其余错误原样透传——formatToolErrorForLlm
 * 会解 cause 给模型可读文案。
 */
function curlPhaseError(
  e: unknown,
  aborted: boolean,
  url: string,
  timeoutMs: number
): unknown {
  if (aborted) {
    return new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
  }
  return e;
}

/**
 * 按块增量累计字符串的 UTF-8 字节数：每块临时字节数组即奔，避免对
 * 全量字符串再 encode 一份完整数组。请求体入参校验与正文 originalBytes
 * 共用（后者是解码后口径而非线上压缩传输字节数）。
 */
function utf8ByteLength(text: string): number {
  const encoder = new TextEncoder();
  const CHUNK = 8192;
  let total = 0;
  for (let i = 0; i < text.length; i += CHUNK) {
    total += encoder.encode(
      text.slice(i, Math.min(i + CHUNK, text.length))
    ).byteLength;
  }
  return total;
}

/**
 * 按字节预算返回正文前缀：TextEncoder 增量编码并累计字节数，
 * 找到预算内能容纳的最大字符切点后在该处截断。
 *
 * 不能按字符数切：含多字节字符时等量字符可膨胀到远超预算
 * （如中文 3 字节/字符）。代理对成对推进，避免切在半个字符上。
 */
function truncateToByteBudget(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const CHUNK = 8192;
  let used = 0;
  for (let i = 0; i < text.length; i += CHUNK) {
    const chunk = text.slice(i, Math.min(i + CHUNK, text.length));
    const chunkBytes = encoder.encode(chunk).byteLength;
    if (used + chunkBytes <= maxBytes) {
      used += chunkBytes;
      continue;
    }
    // 该块超预算：块内逐码位（代理对成对）推进，找到恰好装满预算的切点。
    for (let j = 0; j < chunk.length; ) {
      const codePoint = chunk.codePointAt(j)!;
      const charLength = codePoint > 0xffff ? 2 : 1;
      const charBytes = encoder.encode(
        String.fromCodePoint(codePoint)
      ).byteLength;
      if (used + charBytes > maxBytes) {
        return text.slice(0, i + j);
      }
      used += charBytes;
      j += charLength;
    }
    return text.slice(0, i + chunk.length);
  }
  return text;
}

/** 请求头 key 是否为 content-type（大小写不敏感）。 */
function isContentTypeKey(name: string): boolean {
  return name.toLowerCase() === "content-type";
}

/**
 * 静态 `curl` 工具实例。
 *
 * description 是静态 lambda（不依赖 ctx 动态内容）；是否对 LLM 可见由
 * `resolveAgentToolRegistry` 的 tools.allow/deny 控制（curl 不在任何
 * 摘除分支内，主/子/孙 agent 全深度可用）。
 */
export const curlTool: Tool<CurlToolInput, CurlToolOutput, BuiltinToolContext> =
  {
    name: "curl",
    description:
      () => `对 http/https URL 发起 HTTP 请求（对齐 curl 定位），支持自定义方法、请求头与请求体，返回状态码、内容类型与响应正文。适用于获取或提交网页、接口文档与 API 内容。

入参：
- url：目标 URL，仅支持 http/https 协议（file://、ftp://、data: 等会被拒绝）
- method：HTTP 方法 GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS，默认 GET
- headers：可选自定义请求头，最多 16 条（名称仅限字母/数字/连字符/下划线，单条值上限 8KB）
- body：可选请求体，上限 1MB；GET/HEAD 不携带请求体；有 body 且未显式给 content-type 时默认 application/json
- timeout：超时秒数，默认 30，上限 120

结果格式：可读文本，非 JSON——第一行为「curl METHOD url」请求行（发生重定向时附「→ 最终 URL」），第二行为 Status 状态行（含 content-type），空行后是正文文本；正文超过 256KB 时按字节截断，末尾附截断标注；非文本类型（如图片）返回占位说明，不回流内容。
- status：HTTP 状态码（非 2xx 也照常返回，不会当作工具错误）。
- body：响应正文，超过 256KB 时按字节截断并置 truncated=true；非文本类型返回占位说明。
- finalUrl：重定向后的最终 URL。

注意：无鉴权管理（需要时经 headers 自行携带 token）；网络错误或超时会返回可读错误。`,
    inputSchema: z
      .object({
        url: z
          .string()
          .min(1)
          .describe("目标 URL，仅支持 http/https 协议")
          .superRefine((value, ctx) => {
            // 协议白名单：不用 z.string().url()（它放行任意协议），
            // file://、ftp://、data: 等要在 schema 层即拒绝，
            // 经 ToolRunner 转成 INVALID_ARGUMENT 让模型收到可读 issue 文案。
            let parsed: URL;
            try {
              parsed = new URL(value);
            } catch {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `无效的 URL: ${value}`,
              });
              return;
            }
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `仅支持 http/https 协议，收到: ${parsed.protocol}`,
              });
            }
          }),
        method: z
          .enum(HTTP_METHODS)
          .default("GET")
          .describe("HTTP 方法，默认 GET"),
        headers: z
          .record(z.string(), z.string())
          .describe("可选自定义请求头（最多 16 条，单条值上限 8KB）")
          .superRefine((value, ctx) => {
            const entries = Object.entries(value);
            if (entries.length > CURL_MAX_HEADERS) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `请求头最多 ${CURL_MAX_HEADERS} 条，收到 ${entries.length} 条`,
              });
              return;
            }
            for (const [name, headerValue] of entries) {
              // header 名正则白名单：混入空格/冒号/CR/LF 等字符时，底层
              // 可能按行切割出新 header（CRLF 注入），schema 层直接拒绝。
              if (!HEADER_NAME_PATTERN.test(name)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `请求头名称不合法（仅限字母/数字/连字符/下划线，长度 1-64）: ${JSON.stringify(
                    name
                  )}`,
                });
                continue;
              }
              if (headerValue.includes("\r") || headerValue.includes("\n")) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `请求头 ${name} 的值不允许包含换行符（CR/LF）`,
                });
                continue;
              }
              if (utf8ByteLength(headerValue) > CURL_MAX_HEADER_VALUE_BYTES) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `请求头 ${name} 的值超过 ${CURL_MAX_HEADER_VALUE_BYTES} 字节上限`,
                });
              }
            }
          })
          .optional(),
        body: z
          .string()
          .describe("可选请求体（上限 1MB；GET/HEAD 不携带请求体）")
          .superRefine((value, ctx) => {
            if (utf8ByteLength(value) > CURL_MAX_REQUEST_BODY_BYTES) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `请求体超过 ${CURL_MAX_REQUEST_BODY_BYTES} 字节上限`,
              });
            }
          })
          .optional(),
        timeout: z
          .number()
          .int()
          .min(1)
          .max(CURL_MAX_TIMEOUT_SECONDS)
          .default(CURL_DEFAULT_TIMEOUT_SECONDS)
          .describe("超时秒数，默认 30，上限 120"),
      })
      .superRefine((value, ctx) => {
        // GET/HEAD 按 HTTP 语义不携带请求体：有 body 且 method 为 GET/HEAD
        // 时在 schema 层报错（模型应换 POST/PUT 等或去掉 body）。
        if (
          value.body != null &&
          (value.method === "GET" || value.method === "HEAD")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `method 为 ${value.method} 时不允许携带 body`,
          });
        }
      }),
    outputSchema: z.object({
      url: z.string().describe("规范化后的请求 URL"),
      finalUrl: z
        .string()
        .describe("重定向后最终 URL（与请求 URL 相同时仍回填）"),
      method: z.string().describe("实际使用的 HTTP 方法（缺省 GET）"),
      status: z.number().describe("HTTP 状态码（非 2xx 也照常返回）"),
      contentType: z.string().describe("响应 content-type，缺省为空串"),
      body: z.string().describe("截断后的正文文本；非文本类型为占位说明"),
      truncated: z.boolean().describe("正文是否被截断"),
      originalBytes: z
        .number()
        .describe(
          "原始正文字节数（文本路径为解码后 UTF-8 口径，预检与非文本路径回填 content-length）"
        ),
    }),
    async run(input, ctx) {
      const doFetch = ctx.fetchFn ?? globalThis.fetch;
      const normalizedUrl = new URL(input.url).href;
      const method = input.method ?? "GET";
      const timeoutMs = (input.timeout ?? CURL_DEFAULT_TIMEOUT_SECONDS) * 1000;

      // 组装请求头：显式 headers 原样透传；有 body 且未显式给 content-type
      // 时补默认 application/json（API 提交的常见口径）。
      const requestHeaders = new Headers();
      let hasExplicitContentType = false;
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        if (isContentTypeKey(name)) {
          hasExplicitContentType = true;
        }
        requestHeaders.set(name, value);
      }
      const hasBody = input.body != null && input.body.length > 0;
      if (hasBody && !hasExplicitContentType) {
        requestHeaders.set("content-type", "application/json");
      }

      // 超时须包住 fetch + 正文读取整体：响应头到达不结束计时，
      // `text()` 下载正文阶段同样受 abort 约束，慢滴流不会无限挂起回合。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let text: string;
      try {
        try {
          response = await doFetch(normalizedUrl, {
            method,
            signal: controller.signal,
            redirect: "follow",
            headers: requestHeaders,
            ...(hasBody ? { body: input.body } : {}),
          });
        } catch (e) {
          throw toolFailed(
            "curl",
            curlPhaseError(
              e,
              controller.signal.aborted,
              normalizedUrl,
              timeoutMs
            )
          );
        }

        const contentType = response.headers.get("content-type") ?? "";
        const finalUrl = response.url.length > 0 ? response.url : normalizedUrl;

        // content-length 预检：声明的正文超过上限时不读 body（防巨响应内存峰值），
        // 直接返回占位 + 截断标注；originalBytes 回填 content-length 头数值。
        const declaredLength = parseContentLength(response);
        if (
          declaredLength != null &&
          declaredLength > CURL_MAX_RESPONSE_BYTES
        ) {
          return {
            url: normalizedUrl,
            finalUrl,
            method,
            status: response.status,
            contentType,
            body: `[response too large, not downloaded]\n\nOutput truncated (original ${declaredLength} bytes).`,
            truncated: true,
            originalBytes: declaredLength,
          };
        }

        // 非文本 Content-Type：contentType 响应头阶段即已知，无需下载正文——
        // 直接占位说明，体积回填 content-length 头（缺失时无法得知，标 unknown）。
        if (!isTextualContentType(contentType)) {
          const binaryBytes = declaredLength;
          return {
            url: normalizedUrl,
            finalUrl,
            method,
            status: response.status,
            contentType,
            body:
              binaryBytes != null
                ? `[binary content, ${binaryBytes} bytes, not shown]`
                : `[binary content, unknown size, not shown]`,
            truncated: false,
            originalBytes: binaryBytes ?? 0,
          };
        }

        try {
          text = await response.text();
        } catch (e) {
          // 超时 abort 后 text() 会 reject（undici 对 body 读取同样响应 signal），
          // 这里给出与 fetch 阶段一致的可读超时文案。
          throw toolFailed(
            "curl",
            curlPhaseError(
              e,
              controller.signal.aborted,
              normalizedUrl,
              timeoutMs
            )
          );
        }

        const originalBytes = utf8ByteLength(text);

        // 字节预算截断：截断点按 UTF-8 字节计，末尾标注行不计入预算。
        if (originalBytes > CURL_MAX_BODY_BYTES) {
          const kept = truncateToByteBudget(text, CURL_MAX_BODY_BYTES);
          return {
            url: normalizedUrl,
            finalUrl,
            method,
            status: response.status,
            contentType,
            body: `${kept}\n\nOutput truncated (original ${originalBytes} bytes).`,
            truncated: true,
            originalBytes,
          };
        }

        return {
          url: normalizedUrl,
          finalUrl,
          method,
          status: response.status,
          contentType,
          body: text,
          truncated: false,
          originalBytes,
        };
      } finally {
        // 请求整体结束（成功、失败或提前 return）后清计时器，防悬挂。
        clearTimeout(timer);
      }
    },
  };
