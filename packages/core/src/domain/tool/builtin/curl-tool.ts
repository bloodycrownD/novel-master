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
 * - 超预算落盘（overflow-sink）：正文超过 `TOOL_OUTPUT_MAX_BYTES`
 *   （50KB，与 read/grep 等四工具同预算）时，截断前的全文落盘会话
 *   工作区 `/tmp/`（子代理经装配链落父会话工作区），`body` 置空串
 *   占位、输出附 `savedPath`/`message`；落盘失败（如 vfs 不可用）
 *   降级回字节截断，不因落盘故障丢正文。
 * - 请求体 content-type：headers 显式给就用显式的；有 body 且未显式
 *   给 content-type 时默认 application/json（API 提交的常见口径）。
 * - 不做确认门 / 域名白名单 / SSRF 私网拦截（用户拍板：简单搞、参考
 *   curl；协议白名单之外的限制列为 known limitation，见 spec 偏离记录）。
 *
 * @module domain/tool/builtin/curl-tool
 */

import { z } from "zod";

import { utf8ByteLength } from "@/common/encoding.js";
import { toolFailed } from "@/errors/tool-errors.js";
import { TOOL_OUTPUT_MAX_BYTES } from "../logic/tool-output-limits.js";
import type { Tool } from "../model/tool.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { sinkOversizedOutput, type OversizedSinkResult } from "./overflow-sink.js";
import { createLogger } from "@/infra/log/logger.js";

const log = createLogger("tool.curl");

/** 支持的 HTTP 方法（对齐 curl 常用子集，method 入参枚举来源）。 */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** 默认超时（秒）：入参 timeout 缺省值，到期 abort 返回可读 ToolError。 */
const CURL_DEFAULT_TIMEOUT_SECONDS = 30;

/** 超时上限（秒）：入参 timeout 的 schema 层硬顶。 */
const CURL_MAX_TIMEOUT_SECONDS = 120;

/** content-length 预检上限：响应头声明超过此值时不读 body。 */
const CURL_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** 自定义请求头条数上限。 */
const CURL_MAX_HEADERS = 16;

/**
 * header 名合法字符集：字母 / 数字 / 连字符 / 下划线，长度 1-64。
 * 禁止空格、冒号、CR/LF 等字符——header 名或值一旦混入 CRLF，
 * 会被底层按行切割成新 header（CRLF 注入），这里在 schema 层拒绝。
 */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 单条 header 值的字节上限。 */
const CURL_MAX_HEADER_VALUE_BYTES = 8 * 1024;

/** 请求体入参的字节上限（schema 层拒绝，超限不发请求）。 */
const CURL_MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** `curl` 工具输入。 */
interface CurlToolInput {
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
interface CurlToolOutput {
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
  /** 超预算落盘路径（overflow-sink）：仅正文超 50KB 落盘成功时存在。 */
  readonly savedPath?: string;
  /** 超预算落盘说明（与 savedPath 成对出现）。 */
  readonly message?: string;
}

/** 非 `text/` 主类型里按文本处理的 subtype 关键字（与工具描述同口径）。 */
const TEXTUAL_CONTENT_TYPE_HINTS = ["json", "xml", "javascript", "svg", "yaml", "urlencoded"];

/**
 * 按字节预算返回正文前缀：TextEncoder 增量编码并累计字节数，
 * 找到预算内能容纳的最大字符切点后在该处截断。
 *
 * 不能按字符数切：含多字节字符时等量字符可膨胀到远超预算
 * （如中文 3 字节/字符）。代理对成对推进，避免切在半个字符上。
 */
// nm-style: keep-local — 外层块扫描与块内码位扫描共享 `used` 游标，切点必须落在完整码位边界；内联到 run 会把这条推进不变量拆进 fetch 分支。
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
      const charBytes = encoder.encode(String.fromCodePoint(codePoint)).byteLength;
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
 * 静态 `curl` 工具实例。
 *
 * description 是静态 lambda（不依赖 ctx 动态内容）；是否对 LLM 可见由
 * `resolveAgentToolRegistry` 的 tools.allow/deny 控制（curl 不在任何
 * 摘除分支内，主/子/孙 agent 全深度可用）。
 */
/** url 入参 schema：协议白名单校验在工具实例处的 superRefine（issue 文案贴使用点）。 */
const CURL_URL_SCHEMA = z.string().min(1).describe("目标 URL，仅支持 http/https 协议");
/** headers 入参 schema：数量 / 命名 / CR-LF / 字节预算校验在工具实例处的 superRefine。 */
const CURL_HEADERS_SCHEMA = z.record(z.string(), z.string()).describe("可选自定义请求头（最多 16 条，单条值上限 8KB）");
/** body 入参 schema：1MB 字节预算校验在工具实例处的 superRefine。 */
const CURL_BODY_SCHEMA = z.string().describe("可选请求体（上限 1MB；GET/HEAD 不携带请求体）");
/** 入参 schema 对象：逐字段校验见各 superRefine；跨字段校验（GET/HEAD 不携带 body）在工具实例处补 superRefine。 */
const CURL_INPUT_SCHEMA = z.object({
  url: CURL_URL_SCHEMA.superRefine((value, ctx) => {
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
  method: z.enum(HTTP_METHODS).default("GET").describe("HTTP 方法，默认 GET"),
  headers: CURL_HEADERS_SCHEMA.superRefine((value, ctx) => {
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
          message: `请求头名称不合法（仅限字母/数字/连字符/下划线，长度 1-64）: ${JSON.stringify(name)}`,
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
  }).optional(),
  body: CURL_BODY_SCHEMA.superRefine((value, ctx) => {
    if (utf8ByteLength(value) > CURL_MAX_REQUEST_BODY_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `请求体超过 ${CURL_MAX_REQUEST_BODY_BYTES} 字节上限`,
      });
    }
  }).optional(),
  timeout: z.number().int().min(1).max(CURL_MAX_TIMEOUT_SECONDS).default(CURL_DEFAULT_TIMEOUT_SECONDS).describe("超时秒数，默认 30，上限 120"),
});

export const curlTool: Tool<CurlToolInput, CurlToolOutput, BuiltinToolContext> = {
  name: "curl",
  description: () => `对 http/https URL 发起 HTTP 请求（对齐 curl 定位），支持自定义方法、请求头与请求体，返回状态码、内容类型与响应正文。适用于获取或提交网页、接口文档与 API 内容。

入参：
- url：目标 URL，仅支持 http/https 协议（file://、ftp://、data: 等会被拒绝）
- method：HTTP 方法 GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS，默认 GET
- headers：可选自定义请求头，最多 16 条（名称仅限字母/数字/连字符/下划线，单条值上限 8KB）
- body：可选请求体，上限 1MB；GET/HEAD 不携带请求体；有 body 且未显式给 content-type 时默认 application/json
- timeout：超时秒数，默认 30，上限 120

结果格式：可读文本，非 JSON——第一行为「curl METHOD url」请求行（发生重定向时附「→ 最终 URL」），第二行为 Status 状态行（含 content-type），空行后是正文文本；正文超过 50KB 时自动保存到会话工作区 /tmp/（可用 read 读取），空行后显示落盘路径。
- status：HTTP 状态码（非 2xx 也照常返回，不会当作工具错误）。
- body：响应正文；超过 50KB 时全文自动保存到会话工作区 /tmp/ 并置 truncated=true、附 savedPath 与 message（body 为空串占位，可用 read 读取全文）；非文本类型返回占位说明。
- finalUrl：重定向后的最终 URL。

注意：无鉴权管理（需要时经 headers 自行携带 token）；网络错误或超时会返回可读错误。`,
  inputSchema: CURL_INPUT_SCHEMA.superRefine((value, ctx) => {
    // GET/HEAD 按 HTTP 语义不携带请求体：有 body 且 method 为 GET/HEAD
    // 时在 schema 层报错（模型应换 POST/PUT 等或去掉 body）。
    if (value.body != null && (value.method === "GET" || value.method === "HEAD")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `method 为 ${value.method} 时不允许携带 body`,
      });
    }
  }),
  outputSchema: z.object({
    url: z.string().describe("规范化后的请求 URL"),
    finalUrl: z.string().describe("重定向后最终 URL（与请求 URL 相同时仍回填）"),
    method: z.string().describe("实际使用的 HTTP 方法（缺省 GET）"),
    status: z.number().describe("HTTP 状态码（非 2xx 也照常返回）"),
    contentType: z.string().describe("响应 content-type，缺省为空串"),
    body: z.string().describe("截断后的正文文本；非文本类型为占位说明"),
    truncated: z.boolean().describe("正文是否被截断"),
    originalBytes: z.number().describe("原始正文字节数（文本路径为解码后 UTF-8 口径，预检与非文本路径回填 content-length）"),
    savedPath: z.string().optional().describe("超预算落盘路径：正文超 50KB 时全文保存到会话工作区 /tmp/ 后回填"),
    message: z.string().optional().describe("超预算落盘说明（与 savedPath 成对出现）"),
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
      if (name.toLowerCase() === "content-type") {
        hasExplicitContentType = true;
      }
      requestHeaders.set(name, value);
    }
    const hasBody = input.body != null && input.body.length > 0;
    if (hasBody && !hasExplicitContentType) {
      requestHeaders.set("content-type", "application/json");
    }

    // 预取消早退（B-2）：进入时 signal 已 aborted 直接拒绝，不发请求。对已
    // aborted 的 signal 注册 listener 不会补发回调（WHATWG 语义），不走
    // ToolRunner 兜底的直调入口（测试 / 未来装配点）会白占网络资源直到 timeoutMs。
    if (ctx.signal?.aborted) throw toolFailed("curl", new Error(`请求已取消：${normalizedUrl}`));
    // 超时须包住 fetch + 正文读取整体：响应头到达不结束计时，
    // `text()` 下载正文阶段同样受 abort 约束，慢滴流不会无限挂起回合。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 父级取消（用户点停止 / 回合中断）立即 aborts 在途请求，不必等到超时。
    const parentSignal = ctx.signal;
    const onParentAbort = () => {
      controller.abort(parentSignal?.reason);
    };
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    // fetch / text() 两阶段的错误统一映射：父级取消与超时分开报（两者都让
    // controller.signal 为 aborted），其余错误原样透传——formatToolErrorForLlm
    // 会解 cause 给模型可读文案。
    const phaseError = (e: unknown): unknown => {
      if (!controller.signal.aborted) return e;
      return new Error(parentSignal?.aborted === true ? `请求已取消：${normalizedUrl}` : `Request timed out after ${timeoutMs}ms: ${normalizedUrl}`);
    };
    let response: Response;
    let text: string;
    try {
      try {
        const requestInit: RequestInit = {
          method,
          signal: controller.signal,
          redirect: "follow",
          headers: requestHeaders,
          ...(hasBody ? { body: input.body } : {}),
        };
        response = await doFetch(normalizedUrl, requestInit);
      } catch (e) {
        throw toolFailed("curl", phaseError(e));
      }

      const contentType = response.headers.get("content-type") ?? "";
      const finalUrl = response.url.length > 0 ? response.url : normalizedUrl;

      // content-length 预检：声明的正文超过上限时不读 body（防巨响应内存峰值），
      // 直接返回占位 + 截断标注；originalBytes 回填 content-length 头数值。
      const declaredValue = Number(response.headers.get("content-length") ?? NaN);
      const declaredLength = Number.isFinite(declaredValue) && declaredValue >= 0 ? declaredValue : null;
      if (declaredLength != null && declaredLength > CURL_MAX_RESPONSE_BYTES) {
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
      const lowerContentType = contentType.toLowerCase();
      const textualMain = contentType.length === 0 || lowerContentType.startsWith("text/");
      const textualSubtype = TEXTUAL_CONTENT_TYPE_HINTS.some((hint) => lowerContentType.includes(hint));
      if (!textualMain && !textualSubtype) {
        const binaryBytes = declaredLength;
        return {
          url: normalizedUrl,
          finalUrl,
          method,
          status: response.status,
          contentType,
          body: binaryBytes != null ? `[binary content, ${binaryBytes} bytes, not shown]` : `[binary content, unknown size, not shown]`,
          truncated: false,
          originalBytes: binaryBytes ?? 0,
        };
      }

      try {
        text = await response.text();
      } catch (e) {
        // 超时 / 取消 abort 后 text() 会 reject（undici 对 body 读取同样响应 signal），
        // phaseError 给出与 fetch 阶段一致的文案。
        throw toolFailed("curl", phaseError(e));
      }

      const originalBytes = utf8ByteLength(text);

      // 超 50KB 预算（与 read/grep 等四工具同口径）：截断前的全文落盘
      // 会话工作区 /tmp/，body 置空串占位（schema 必填不变，meta 全保留），
      // 模型经 savedPath 用 read 分页读取。落盘失败（如 vfs 不可用）
      // 降级回字节截断——正文已到手，不因落盘故障丢弃。
      if (originalBytes > TOOL_OUTPUT_MAX_BYTES) {
        let sink: OversizedSinkResult | undefined;
        try {
          sink = await sinkOversizedOutput(ctx, { tool: "curl", content: text, contentType });
        } catch (error) {
          log.debug("超预算落盘失败，降级字节截断", { error });
        }
        if (sink != null) {
          return {
            url: normalizedUrl,
            finalUrl,
            method,
            status: response.status,
            contentType,
            body: "",
            truncated: true,
            originalBytes,
            savedPath: sink.savedPath,
            message: sink.message,
          };
        }
        const kept = truncateToByteBudget(text, TOOL_OUTPUT_MAX_BYTES);
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
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  },
};
