/**
 * `search` 工具统一内部接口：模板执行器 / DuckDuckGo 适配器与工具本体共用的
 * 类型和小型纯函数。
 *
 * 设计口径（SPEC web-search-curl）：
 * - bocha / tavily / brave / searxng 四适配器已退役为出厂模板，deepseek / zhipu
 *   与自定义实例同为模板；模板执行器把响应映射到本模块的 `SearchResponse`
 *   统一形状，answer 只有模板 answerPath 命中才透传。
 * - 默认条数 5、clamp 1..20（0 或非法值回落 5——「未给有效值」与「缺省」同义，
 *   大于 20 收敛到 20）。
 * - 适配器 / 执行器不持有任何配置读取逻辑：凭据经 `ResolvedEngineConfig` 参数注入
 *   （明文 key 只在 resolveEngineChain 内现读、不驻留），HTTP 超时统一
 *   `AbortController + setTimeout`（RN/Hermes 兼容，不用 AbortSignal.timeout/any），
 *   无 SSRF 拦截层（照 curl 工具拍板：简单搞）。
 *
 * 模板模型（SPEC web-search-curl Step 1）：`SearchEngineTemplate` 描述一次可执行的
 * 引擎请求（占位符 URL/headers/body + 结果点路径 + 候选字段映射 + 可选业务信封），
 * `validateSearchEngineTemplate` 是保存路径的唯一校验入口（返回 Result，不 throw）；
 * 执行器在 `engines/template-engine.ts`。
 *
 * @module domain/tool/builtin/search/types
 */

import { isRecord } from "@/common/guards.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { findPlaintextSecrets } from "./curl-import.js";

/** 单条搜索结果（模板引擎与 DuckDuckGo 统一形状）。 */
export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/**
 * 搜索响应：`engine` 回填实际使用的引擎实例 id（动态全集，模型可见），
 * `answer` 仅模板 answerPath 命中的引擎透传（其余省略，不从 results 拼装）。
 */
export interface SearchResponse {
  readonly engine: string;
  readonly answer?: string;
  readonly results: readonly SearchResult[];
}

/**
 * 落盘形态输出（超 50KB 保险丝触发后）：正文已写入会话工作区 `/tmp/`，
 * 工具结果只回路径与说明（overflow-sink Step 5/6 接线后出现）。
 */
export interface SearchOversizeOutput {
  readonly engine: string;
  readonly savedPath: string;
  readonly message: string;
}

/**
 * 工具层串行链成功输出：`SearchResponse` 叠加尝试轨迹 `attempts`
 * （如「bocha 失败(401) → tavily 成功」；链首首发成功时省略该字段，
 * 零降级无轨迹可记）。适配器层不感知该字段。
 */
export type SearchChainOutput = SearchResponse & {
  readonly attempts?: string;
};

/** paramHint 长度上限：保存路径硬校验，装配期描述快照再做防御性截断（双道，SPEC §2）。 */
export const SEARCH_PARAM_HINT_MAX_LENGTH = 500;

/** 引擎执行入参选项（query / engine / params 在 search-tool 层消费）。 */
export interface SearchToolOptions {
  readonly maxResults?: number;
}

/**
 * 引擎解析结果：凭据与模板随参数注入适配器 / 模板执行器（明文 key 只在
 * resolveEngineChain 内经 secretStore 现读，不落在任何缓存 / 日志 / KKV）。
 *
 * 模板由链解析一次性携带（全仓唯一查模板点）：dispatch 只按 `engine` 路由，
 * 不做二次查找。duckduckgo 无模板（HTML 解析适配器保留），`template` 恒缺省。
 */
export interface ResolvedEngineConfig {
  /** 引擎实例 id（动态全集：预置 / custom:{nanoid8} / duckduckgo）。 */
  readonly engine: string;
  /** 模板引用 `{{apiKey}}` 时的明文 API key；不引用则缺省。 */
  readonly apiKey?: string;
  /** 模板引用 `{{baseUrl}}` 时的规范化 baseUrl（http/https、无尾斜杠）；不引用则缺省。 */
  readonly baseUrl?: string;
  /** 引擎模板（duckduckgo 缺省）。 */
  readonly template?: SearchEngineTemplate;
}

/** 默认结果条数（maxResults 缺省 / 非法 / 小于 1 时回落此值）。 */
export const DEFAULT_MAX_RESULTS = 5;

/** 结果条数上限（超过时收敛到该值，不报错）。 */
export const MAX_RESULTS_LIMIT = 20;

/**
 * 归一化结果条数：缺省 / 非有限数 / 小于 1 → 5；其余向下取整并 clamp 到
 * 1..20（0→5、99→20，T-A5 锁定该口径）。模板执行器与 DuckDuckGo 适配器共用。
 */
export function normalizeMaxResults(value: number | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.min(Math.floor(value), MAX_RESULTS_LIMIT);
}

/**
 * 引擎错误消息脱敏：把明文 key 从文本中替换为 `***`——个别引擎 401 响应体
 * 会回显鉴权头，脱敏保证 key 明文绝不进错误信息 / 日志 / 工具输出。
 */
export function redactSecret(text: string, secret?: string): string {
  if (secret == null || secret.length === 0) return text;
  return text.split(secret).join("***");
}

/**
 * 统一引擎 HTTP 错误范式：`` `${Engine} API error ${status}: ${body.slice(0,300)}` ``。
 * body 先经 redactSecret 脱敏再截断。
 */
export function engineApiErrorMessage(engine: string, status: number, body: string, apiKey?: string): string {
  return `${engine} API error ${status}: ${redactSecret(body, apiKey).slice(0, 300)}`;
}

/**
 * 引擎执行失败的统一 AppError（TOOL_SEARCH_FAILED）：消息原样保留，
 * search-tool 只读 message 聚合成 ToolError，不按 key 分支。
 */
export function engineFailed(message: string): AppError<"TOOL_SEARCH_FAILED"> {
  return new AppError("TOOL_SEARCH_FAILED", message);
}

/**
 * 引擎执行超时错误的统一映射：signal 已 abort（计时器触发）给可读超时
 * 文案，其余错误原样透传（照 curl-tool 的 curlPhaseError 模式）。
 */
export function engineTimeoutError(e: unknown, aborted: boolean, engine: string, timeoutMs: number): unknown {
  if (aborted) {
    return engineFailed(`${engine} search timed out after ${timeoutMs}ms`);
  }
  return e;
}

/** 模板占位符白名单（url / headers / bodyTemplate 共用；不在表内即判未知占位符）。 */
const SEARCH_TEMPLATE_PLACEHOLDERS: readonly string[] = ["query", "count", "apiKey", "baseUrl"];

/**
 * 模板占位符 token 扫描正则（`{{name}}`，名字允许为空以便把 `{{}}` 也判成未知占位符）。
 * 带 g 标志：只给 `replace` / `matchAll` 用，两者都会把 lastIndex 归零，可安全共享。
 */
export const SEARCH_TEMPLATE_PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

/**
 * 模板点路径语法：点分标识符段，不支持数组索引。resultPath / answerPath /
 * envelope.codePath / envelope.msgPath 共用同一规则，执行器侧共用同一遍历实现。
 */
const POINT_PATH_PATTERN = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

/** 结果字段候选名列表：按序取第一个非空字符串（各引擎响应字段容错）。 */
export interface SearchEngineFieldMap {
  readonly title: readonly string[];
  readonly url: readonly string[];
  readonly snippet: readonly string[];
}

/** 业务信封校验（bocha 形态）：codePath 取到值且不在 okValues 时视为业务失败。 */
export interface SearchEngineEnvelope {
  /** 业务码点路径（如 "code"）。 */
  readonly codePath: string;
  /** 视为成功的业务码；缺省 `[200, "200"]`。 */
  readonly okValues?: readonly (string | number)[];
  /** 失败消息点路径（脱敏后拼进错误文案）。 */
  readonly msgPath?: string;
}

/**
 * 搜索模板：一份可执行、可编辑的引擎请求描述（出厂预置与自定义实例共用）。
 *
 * 占位符语义见 template-engine：URL 内仅 `{{query}}` 百分号编码，其余原样替换；
 * body 先 JSON.parse 再结构化遍历字符串值（整值 `"{{count}}"` 替换为 number）。
 */
export interface SearchEngineTemplate {
  /** 显示名（工具描述 / 设置页 / 错误文案共用）。 */
  readonly name: string;
  readonly method: "GET" | "POST";
  /** 可含 `{{query}}` / `{{count}}` / `{{apiKey}}` / `{{baseUrl}}`。 */
  readonly url: string;
  /** 头值可内插占位符（如 `Bearer {{apiKey}}`，apiKey 不编码）。 */
  readonly headers: Readonly<Record<string, string>>;
  /** POST 必填：合法 JSON 对象文本，占位符只出现在字符串值内。 */
  readonly bodyTemplate?: string;
  /** 点路径定位结果数组（空串 = 根节点即数组，如 "data.webPages.value"）。 */
  readonly resultPath: string;
  readonly fieldMap: SearchEngineFieldMap;
  /** 顶层点路径，取到非空字符串则透传 answer。 */
  readonly answerPath?: string;
  readonly envelope?: SearchEngineEnvelope;
  /** 参数说明（≤500 字符，装配期拼进工具描述）。 */
  readonly paramHint: string;
}

/** 自定义引擎实例：模板本体只存占位符，明文 key / baseUrl 另存 SKSP / engineBaseUrls。 */
export interface CustomEngineDef {
  /** `custom:{nanoid8}`。 */
  readonly id: string;
  readonly name: string;
  readonly template: SearchEngineTemplate;
  /** ISO 8601。 */
  readonly createdAt: string;
}

/** 模板校验失败载荷（错误码 `TOOL_SEARCH_TEMPLATE_INVALID`；与运行时引擎失败的 TOOL_SEARCH_FAILED 通道互不相干）。 */
type SearchTemplateValidationError = AppError<"TOOL_SEARCH_TEMPLATE_INVALID">;

/** URL 校验用占位符示例值：替换后才能对 `{{baseUrl}}/search?...` 这类模板串做 `new URL()`。 */
const TEMPLATE_PLACEHOLDER_EXAMPLES: Readonly<Record<string, string>> = { query: "example", count: "5", apiKey: "example-api-key", baseUrl: "https://example.invalid" };

/** 返回文本里第一个不在白名单内的占位符名字（无则 null）。 */
function unknownPlaceholderIn(text: string): string | null {
  for (const match of text.matchAll(SEARCH_TEMPLATE_PLACEHOLDER_PATTERN)) {
    const name = match[1] ?? "";
    if (!SEARCH_TEMPLATE_PLACEHOLDERS.includes(name)) return name;
  }
  return null;
}

/** 字段候选列表：非空数组且每项为非空字符串（trim 后）才返回，否则 null。 */
function readFieldCandidates(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const candidates: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) return null;
    candidates.push(item.trim());
  }
  return candidates;
}

/**
 * 校验并归一化模板输入（保存路径统一入口；入参按不可信处理，返回新对象、不回填未知键）。
 *
 * 规则（SPEC §2）：method ∈ {GET, POST}；url 为非空 http(s)（先用示例值替换占位符再
 * `new URL()`，searxng 的 `{{baseUrl}}/search?...` 形态因此可过）；resultPath 为空串
 * （根）或合法点路径，answerPath / envelope.codePath / envelope.msgPath 同规则；
 * fieldMap 三键各至少一个非空候选；POST 必填 bodyTemplate 且为合法 JSON 对象文本，
 * 占位符只允许白名单四个，`{{count}}` 在 body 字符串值内只允许整值出现（执行器替换为
 * number）；paramHint ≤500 字符；url / headers / bodyTemplate 不含明文密钥特征（与
 * curl 导入共用 `findPlaintextSecrets`，全仓唯一检测实现）。错误码统一
 * `TOOL_SEARCH_TEMPLATE_INVALID`，messageKey 取 `error.tool.search_template_invalid`
 * （params 带字段原因）或 `error.tool.search_secret_detected`（params 带字段名）。
 */
export function validateSearchEngineTemplate(raw: unknown): Result<SearchEngineTemplate, SearchTemplateValidationError> {
  const invalid = (reason: string): Result<SearchEngineTemplate, SearchTemplateValidationError> => Result.err(new AppError("TOOL_SEARCH_TEMPLATE_INVALID", { key: "error.tool.search_template_invalid", params: { reason } }));
  if (!isRecord(raw)) return invalid("expected an object");

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length === 0) return invalid("name is required");

  const method = raw.method;
  if (method !== "GET" && method !== "POST") return invalid("method must be GET or POST");

  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (url.length === 0) return invalid("url is required");
  const unknownUrlPlaceholder = unknownPlaceholderIn(url);
  if (unknownUrlPlaceholder != null) return invalid(`url contains unknown placeholder {{${unknownUrlPlaceholder}}}`);
  try {
    const probe = new URL(url.replace(SEARCH_TEMPLATE_PLACEHOLDER_PATTERN, (token, placeholder: string) => TEMPLATE_PLACEHOLDER_EXAMPLES[placeholder] ?? token));
    if (probe.protocol !== "http:" && probe.protocol !== "https:") return invalid("url must use http or https");
  } catch {
    return invalid("url must be a valid http(s) URL");
  }

  if (!isRecord(raw.headers)) return invalid("headers must be an object of string values");
  const headers: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(raw.headers)) {
    if (typeof headerValue !== "string") return invalid(`header ${headerName} must be a string`);
    const unknownHeaderPlaceholder = unknownPlaceholderIn(headerValue);
    if (unknownHeaderPlaceholder != null) return invalid(`header ${headerName} contains unknown placeholder {{${unknownHeaderPlaceholder}}}`);
    headers[headerName] = headerValue;
  }

  const resultPath = typeof raw.resultPath === "string" ? raw.resultPath.trim() : null;
  if (resultPath == null || (resultPath.length > 0 && !POINT_PATH_PATTERN.test(resultPath))) return invalid("resultPath must be a dotted path or empty for the root array");

  let bodyTemplate: string | undefined;
  if (raw.bodyTemplate != null) {
    if (typeof raw.bodyTemplate !== "string") return invalid("bodyTemplate must be JSON text");
    const text = raw.bodyTemplate.trim();
    if (text.length > 0) {
      const unknownBodyPlaceholder = unknownPlaceholderIn(text);
      if (unknownBodyPlaceholder != null) return invalid(`bodyTemplate contains unknown placeholder {{${unknownBodyPlaceholder}}}`);
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(text);
      } catch {
        return invalid("bodyTemplate must be valid JSON");
      }
      if (!isRecord(parsedBody)) return invalid("bodyTemplate must be a JSON object");
      const pending: unknown[] = [parsedBody];
      while (pending.length > 0) {
        const node = pending.pop();
        if (Array.isArray(node)) {
          pending.push(...node);
          continue;
        }
        if (typeof node === "string") {
          if (node.includes("{{count}}") && node !== "{{count}}") return invalid("{{count}} must be a whole-string value in bodyTemplate");
          continue;
        }
        if (isRecord(node)) pending.push(...Object.values(node));
      }
      bodyTemplate = text;
    }
  }
  if (method === "POST" && bodyTemplate == null) return invalid("bodyTemplate is required for POST");

  const rawFieldMap = raw.fieldMap;
  if (!isRecord(rawFieldMap)) return invalid("fieldMap must be an object with title/url/snippet candidates");
  const titleCandidates = readFieldCandidates(rawFieldMap.title);
  const urlCandidates = readFieldCandidates(rawFieldMap.url);
  const snippetCandidates = readFieldCandidates(rawFieldMap.snippet);
  if (titleCandidates == null || urlCandidates == null || snippetCandidates == null) return invalid("fieldMap.title/url/snippet each need at least one non-empty string candidate");

  let answerPath: string | undefined;
  if (raw.answerPath != null) {
    const trimmed = typeof raw.answerPath === "string" ? raw.answerPath.trim() : "";
    if (trimmed.length > 0) {
      if (!POINT_PATH_PATTERN.test(trimmed)) return invalid("answerPath must be a dotted path");
      answerPath = trimmed;
    }
  }

  let envelope: SearchEngineEnvelope | undefined;
  const rawEnvelope = raw.envelope;
  if (rawEnvelope != null) {
    if (!isRecord(rawEnvelope)) return invalid("envelope must be an object");
    const codePath = typeof rawEnvelope.codePath === "string" ? rawEnvelope.codePath.trim() : "";
    if (!POINT_PATH_PATTERN.test(codePath)) return invalid("envelope.codePath must be a dotted path");
    let msgPath: string | undefined;
    if (rawEnvelope.msgPath != null) {
      const trimmed = typeof rawEnvelope.msgPath === "string" ? rawEnvelope.msgPath.trim() : "";
      if (!POINT_PATH_PATTERN.test(trimmed)) return invalid("envelope.msgPath must be a dotted path");
      msgPath = trimmed;
    }
    let okValues: readonly (string | number)[] | undefined;
    if (rawEnvelope.okValues != null) {
      if (!Array.isArray(rawEnvelope.okValues)) return invalid("envelope.okValues must be an array of strings or numbers");
      const values: (string | number)[] = [];
      for (const value of rawEnvelope.okValues) {
        if (typeof value !== "string" && typeof value !== "number") return invalid("envelope.okValues must be an array of strings or numbers");
        values.push(value);
      }
      okValues = values;
    }
    envelope = { codePath, ...(msgPath == null ? {} : { msgPath }), ...(okValues == null ? {} : { okValues }) };
  }

  if (typeof raw.paramHint !== "string") return invalid("paramHint must be a string");
  const paramHint = raw.paramHint.trim();
  if (paramHint.length > SEARCH_PARAM_HINT_MAX_LENGTH) return invalid(`paramHint must be at most ${SEARCH_PARAM_HINT_MAX_LENGTH} characters`);

  const secretFields = [{ field: "url", text: url }, { field: "bodyTemplate", text: bodyTemplate ?? "" }, ...Object.entries(headers).map(([headerName, headerValue]) => ({ field: `headers.${headerName}`, text: `${headerName}: ${headerValue}` }))];
  for (const { field, text } of secretFields) {
    if (findPlaintextSecrets(text).length > 0) return Result.err(new AppError("TOOL_SEARCH_TEMPLATE_INVALID", { key: "error.tool.search_secret_detected", params: { field } }));
  }

  return Result.ok({ name, method, url, headers, ...(bodyTemplate == null ? {} : { bodyTemplate }), resultPath, fieldMap: { title: titleCandidates, url: urlCandidates, snippet: snippetCandidates }, ...(answerPath == null ? {} : { answerPath }), ...(envelope == null ? {} : { envelope }), paramHint });
}
