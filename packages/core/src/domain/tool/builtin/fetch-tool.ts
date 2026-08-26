/**
 * `fetch` 工具实现：对 http/https URL 发起只读 GET 请求，回流状态码、
 * 内容类型与正文文本，让 agent 具备基础联网能力。
 *
 * 设计口径（SPEC fetch-tool）：
 * - 双端同一份实现：走 `globalThis.fetch` + 非流式 `response.text()`，
 *   无平台分支；网络入口经 `ctx.fetchFn` 可选注入（缺省 globalThis.fetch）。
 * - 超时用 `AbortController` + 手动 `setTimeout`（不用 `AbortSignal.timeout`，
 *   规避 RN/Hermes 兼容差异），请求结束后 `clearTimeout` 防悬挂计时器。
 * - HTTP 非 2xx 不算错误（4xx/5xx 也是有效响应，让模型自行解释），
 *   与 LLM provider 层的 `assertOk` 语义刻意不同。
 * - content-length 预检：响应头声明超过 {@link FETCH_MAX_RESPONSE_BYTES}
 *   时不读 body，直接返回占位输出，防巨响应内存峰值。
 * - 截断按字节预算（{@link FETCH_MAX_BODY_BYTES}）而非行数：网页 HTML
 *   常是单行几十万字符，按行截断（`capUtf8Bytes`）会一行都留不下。
 *
 * @module domain/tool/builtin/fetch-tool
 */

import { z } from "zod";

import { toolFailed } from "@/errors/tool-errors.js";
import type { Tool } from "../model/tool.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";

/** 请求超时（毫秒）：到期 abort，返回可读 ToolError 而非挂起。 */
export const FETCH_TIMEOUT_MS = 30_000;

/** 回流正文的字节预算：截断点按 UTF-8 字节计，末尾标注行不计入。 */
export const FETCH_MAX_BODY_BYTES = 50 * 1024;

/** content-length 预检上限：响应头声明超过此值时不读 body。 */
export const FETCH_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** `fetch` 工具输入。 */
export interface FetchToolInput {
  /** 目标 URL，仅支持 http/https 协议（schema 层白名单校验）。 */
  readonly url: string;
}

/** `fetch` 工具输出。 */
export interface FetchToolOutput {
  /** 规范化后的请求 URL。 */
  readonly url: string;
  /** 重定向后的最终 URL（response.url）；与请求 URL 相同时仍回填。 */
  readonly finalUrl: string;
  readonly status: number;
  /** response.headers.get("content-type") ?? ""；缺省按空串返回。 */
  readonly contentType: string;
  /** 截断后的正文文本；非文本 Content-Type 时为占位说明。 */
  readonly body: string;
  /** 正文是否被截断（字节预算或 content-length 预检触发）。 */
  readonly truncated: boolean;
  /**
   * 原始正文字节数，双来源：
   * - 正常路径：读 body 后经 TextEncoder 全量编码计算；
   * - content-length 预检路径：不读 body，回填 content-length 头数值。
   */
  readonly originalBytes: number;
}

/**
 * 判断 Content-Type 是否按文本处理：主类型 `text/`，或 subtype 含
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
        String.fromCodePoint(codePoint),
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

/**
 * 静态 `fetch` 工具实例。
 *
 * description 是静态 lambda（不依赖 ctx 动态内容）；是否对 LLM 可见由
 * `resolveAgentToolRegistry` 的 tools.allow/deny 控制（fetch 不在任何
 * 摘除分支内，主/子/孙 agent 全深度可用）。
 */
export const fetchTool: Tool<
  FetchToolInput,
  FetchToolOutput,
  BuiltinToolContext
> = {
  name: "fetch",
  description: () => `对 http/https URL 发起只读 GET 请求，返回状态码、内容类型与正文文本。适用于获取网页、接口文档或公开 API 的内容。

入参：
- url：目标 URL，仅支持 http/https 协议（file://、ftp://、data: 等会被拒绝）

结果格式：本工具回流一个 JSON 对象，结构为 { url, finalUrl, status, contentType, body, truncated, originalBytes }。
- status：HTTP 状态码（非 2xx 也照常返回，不会当作工具错误）。
- body：正文文本，超过 50KB 时按字节截断并置 truncated=true；非文本类型（如图片）返回占位说明。
- finalUrl：重定向后的最终 URL。

注意：仅支持 GET，无自定义请求头 / Body / 鉴权；网络错误或超时会返回可读错误。`,
  inputSchema: z.object({
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
  }),
  outputSchema: z.object({
    url: z.string().describe("规范化后的请求 URL"),
    finalUrl: z.string().describe("重定向后最终 URL（与请求 URL 相同时仍回填）"),
    status: z.number().describe("HTTP 状态码（非 2xx 也照常返回）"),
    contentType: z.string().describe("响应 content-type，缺省为空串"),
    body: z.string().describe("截断后的正文文本；非文本类型为占位说明"),
    truncated: z.boolean().describe("正文是否被截断"),
    originalBytes: z
      .number()
      .describe("原始正文字节数（正常路径全量计算 / 预检路径回填 content-length）"),
  }),
  async run(input, ctx) {
    const doFetch = ctx.fetchFn ?? globalThis.fetch;
    const normalizedUrl = new URL(input.url).href;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await doFetch(normalizedUrl, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (e) {
      // abort 触发（超时）给专门的可读文案；其余网络错误原样包进 cause，
      // formatToolErrorForLlm 会解 cause 给模型可读文案。
      if (controller.signal.aborted) {
        throw toolFailed(
          "fetch",
          new Error(
            `Request timed out after ${FETCH_TIMEOUT_MS}ms: ${normalizedUrl}`,
          ),
        );
      }
      throw toolFailed("fetch", e);
    } finally {
      clearTimeout(timer);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url.length > 0 ? response.url : normalizedUrl;

    // content-length 预检：声明的正文超过上限时不读 body（防巨响应内存峰值），
    // 直接返回占位 + 截断标注；originalBytes 回填 content-length 头数值。
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader != null) {
      const declared = Number(contentLengthHeader);
      if (
        Number.isFinite(declared) &&
        declared > FETCH_MAX_RESPONSE_BYTES
      ) {
        return {
          url: normalizedUrl,
          finalUrl,
          status: response.status,
          contentType,
          body: `[response too large, not downloaded]\n\nOutput truncated (original ${declared} bytes).`,
          truncated: true,
          originalBytes: declared,
        };
      }
    }

    let text: string;
    try {
      text = await response.text();
    } catch (e) {
      if (controller.signal.aborted) {
        throw toolFailed(
          "fetch",
          new Error(
            `Request timed out after ${FETCH_TIMEOUT_MS}ms: ${normalizedUrl}`,
          ),
        );
      }
      throw toolFailed("fetch", e);
    }

    const originalBytes = new TextEncoder().encode(text).byteLength;

    // 非文本 Content-Type：不回流解码乱码，占位说明 + 回填原始大小。
    if (!isTextualContentType(contentType)) {
      return {
        url: normalizedUrl,
        finalUrl,
        status: response.status,
        contentType,
        body: `[binary content, ${originalBytes} bytes, not shown]`,
        truncated: false,
        originalBytes,
      };
    }

    // 字节预算截断：截断点按 UTF-8 字节计，末尾标注行不计入预算。
    if (originalBytes > FETCH_MAX_BODY_BYTES) {
      const kept = truncateToByteBudget(text, FETCH_MAX_BODY_BYTES);
      return {
        url: normalizedUrl,
        finalUrl,
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
      status: response.status,
      contentType,
      body: text,
      truncated: false,
      originalBytes,
    };
  },
};
