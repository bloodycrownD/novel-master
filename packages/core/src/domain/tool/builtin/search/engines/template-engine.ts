/**
 * 模板搜索执行器（SPEC web-search-curl Step 1，全仓唯一的模板求值实现）。
 *
 * 流程：占位符替换（URL 仅 `{{query}}` 百分号编码；headers 原样内插；body 先
 * JSON.parse 再结构化遍历字符串值，整值 `"{{count}}"` 替换为 number，不做文本级
 * 替换——query 含引号/反斜杠天然安全）→ GET 用 URLSearchParams 合并 params
 * （追加/覆盖同名 query 参数）、POST 浅合并 params（同名以 params 为准）→
 * fetch（统一 30s AbortController 超时）→ 非 2xx 走 engineApiErrorMessage
 * （body 前 300 字符 + redactSecret 脱敏）→ JSON parse → envelope 业务码校验
 * （codePath 取值缺失/undefined = 通过，收编 bocha 现语义；msg 脱敏）→
 * resultPath 取数组（空数组 = 合法空结果）→ 逐条候选字段映射（跳过判据 =
 * url 候选全空；title 缺省回填 url、snippet 缺省空串）→ answerPath 非空透传 →
 * 客户端截断到 maxResults（searxng 等无 count 参数的模板统一靠这一步）。
 *
 * 错误通道（SPEC §4）：沿用四适配器先例 throw `engineFailed`
 * （TOOL_SEARCH_FAILED）/ `engineTimeoutError`，不引入 Result——search-tool 的
 * run 循环是唯一 throw 边界（catch 收 failureLines 进串行降级）。错误文案里的
 * 引擎标识统一用 `template.name` 显示名（不用裸 engine id；响应负载 `engine`
 * 字段仍是 engine id）。模板校验错误码 TOOL_SEARCH_TEMPLATE_INVALID 属于保存
 * 路径，与本执行器无关。
 *
 * @module domain/tool/builtin/search/engines/template-engine
 */

import { isRecord } from "@/common/guards.js";
import { engineApiErrorMessage, engineFailed, engineTimeoutError, normalizeMaxResults, redactSecret, SEARCH_TEMPLATE_PLACEHOLDER_PATTERN, type ResolvedEngineConfig, type SearchEngineTemplate, type SearchResponse, type SearchResult, type SearchToolOptions } from "../types.js";

/** 占位符运行期取值：只有模板真的引用时才要求有值（未引用的可缺省）。 */
interface TemplatePlaceholderValues {
  readonly query: string;
  readonly count: number;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/** 模板引擎统一超时（毫秒）：全部模板共用 30s（AbortController + setTimeout，RN/Hermes 兼容）。 */
const TEMPLATE_ENGINE_TIMEOUT_MS = 30_000;

/** 占位符内插：URL 传 encodeQuery（仅 `{{query}}` 百分号编码），headers/body 原样；displayName（template.name）进错误文案，引用缺值或未知占位符抛可读错误。 */
function substitutePlaceholders(text: string, values: TemplatePlaceholderValues, displayName: string, encodeQuery: boolean): string {
  return text.replace(SEARCH_TEMPLATE_PLACEHOLDER_PATTERN, (_token, placeholder: string) => {
    switch (placeholder) {
      case "query":
        return encodeQuery ? encodeURIComponent(values.query) : values.query;
      case "count":
        return String(values.count);
      case "apiKey":
        if (values.apiKey == null || values.apiKey.length === 0) throw engineFailed(`${displayName} template requires {{apiKey}} but no key is configured`);
        return values.apiKey;
      case "baseUrl":
        if (values.baseUrl == null || values.baseUrl.length === 0) throw engineFailed(`${displayName} template requires {{baseUrl}} but no base URL is configured`);
        return values.baseUrl;
      default:
        throw engineFailed(`${displayName} template contains unknown placeholder {{${placeholder}}}`);
    }
  });
}

/** 点路径取值（""=根；resultPath / answerPath / envelope.codePath / msgPath 共用；不支持数组索引，取不到返回 undefined）。 */
function readPointPath(root: unknown, path: string): unknown {
  let node = root;
  if (path.length === 0) return node;
  for (const segment of path.split(".")) {
    if (!isRecord(node)) return undefined;
    node = node[segment];
  }
  return node;
}

/** 候选字段按序取第一个非空字符串（trim 后），全空返回 null。 */
function firstField(item: Record<string, unknown>, candidates: readonly string[]): string | null {
  for (const key of candidates) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * 按模板发起一次搜索（单引擎请求；串行降级 / 120s 预算 / 50KB 落盘在 search-tool）。
 *
 * `template` 恒等 `resolved.template`（模板由 resolveEngineChain 携带，链解析是全仓
 * 唯一查模板点），分开传只为调用点可读。params 是工具层自由 JSON，原样透传引擎方言
 * 字段，同名覆盖模板默认值。
 */
export async function runTemplateEngine(template: SearchEngineTemplate, resolved: ResolvedEngineConfig, query: string, options: SearchToolOptions, params: Readonly<Record<string, unknown>> = {}, fetchFn: typeof globalThis.fetch): Promise<SearchResponse> {
  const engine = resolved.engine;
  const numResults = normalizeMaxResults(options.maxResults);
  const values: TemplatePlaceholderValues = { query, count: numResults, apiKey: resolved.apiKey, baseUrl: resolved.baseUrl };

  let requestUrl = substitutePlaceholders(template.url, values, template.name, true);
  if (template.method === "GET") {
    try {
      const parsedUrl = new URL(requestUrl);
      for (const [key, value] of Object.entries(params)) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (text != null) parsedUrl.searchParams.set(key, text);
      }
      requestUrl = parsedUrl.toString();
    } catch (e) {
      throw engineFailed(`${template.name} template URL is invalid: ${redactSecret(e instanceof Error ? e.message : String(e), resolved.apiKey)}`);
    }
  }

  const headers: Record<string, string> = {};
  for (const [headerName, headerValue] of Object.entries(template.headers)) headers[headerName] = substitutePlaceholders(headerValue, values, template.name, false);

  let bodyText: string | undefined;
  if (template.method === "POST") {
    if (template.bodyTemplate == null) throw engineFailed(`${template.name} template is missing bodyTemplate for POST`);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(template.bodyTemplate);
    } catch {
      throw engineFailed(`${template.name} template bodyTemplate is not valid JSON`);
    }
    if (!isRecord(parsedBody)) throw engineFailed(`${template.name} template bodyTemplate must be a JSON object`);
    const pending: unknown[] = [parsedBody];
    while (pending.length > 0) {
      const node = pending.pop();
      if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
          const value: unknown = node[index];
          if (typeof value === "string") node[index] = value === "{{count}}" ? numResults : substitutePlaceholders(value, values, template.name, false);
          else pending.push(value);
        }
        continue;
      }
      if (!isRecord(node)) continue;
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string") node[key] = value === "{{count}}" ? numResults : substitutePlaceholders(value, values, template.name, false);
        else pending.push(value);
      }
    }
    bodyText = JSON.stringify({ ...parsedBody, ...params });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEMPLATE_ENGINE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      const init: RequestInit = { method: template.method, headers, signal: controller.signal, ...(bodyText == null ? {} : { body: bodyText }) };
      response = await fetchFn(requestUrl, init);
    } catch (e) {
      throw engineTimeoutError(e, controller.signal.aborted, template.name, TEMPLATE_ENGINE_TIMEOUT_MS);
    }

    if (!response.ok) throw engineFailed(engineApiErrorMessage(template.name, response.status, await response.text(), resolved.apiKey));

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (e) {
      throw engineFailed(`${template.name} API returned invalid JSON: ${redactSecret(e instanceof Error ? e.message : String(e), resolved.apiKey)}`);
    }

    if (template.envelope != null) {
      const { codePath, okValues, msgPath } = template.envelope;
      const code = readPointPath(raw, codePath);
      if (code !== undefined && !(okValues ?? [200, "200"]).some((ok) => ok === code || String(ok) === String(code))) {
        const detail = msgPath == null ? undefined : readPointPath(raw, msgPath);
        const message = typeof detail === "string" && detail.trim().length > 0 ? detail.trim() : "unknown error";
        throw engineFailed(`${template.name} API error ${String(code)}: ${redactSecret(message, resolved.apiKey)}`);
      }
    }

    const items = readPointPath(raw, template.resultPath);
    if (!Array.isArray(items)) throw engineFailed(`${template.name} API returned invalid response: missing ${template.resultPath.length === 0 ? "root" : template.resultPath} results array`);

    const results: SearchResult[] = [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const resultUrl = firstField(item, template.fieldMap.url);
      if (resultUrl == null) continue;
      results.push({ title: firstField(item, template.fieldMap.title) ?? resultUrl, url: resultUrl, snippet: firstField(item, template.fieldMap.snippet) ?? "" });
      if (results.length >= numResults) break;
    }

    const rawAnswer = template.answerPath == null ? undefined : readPointPath(raw, template.answerPath);
    const answer = typeof rawAnswer === "string" && rawAnswer.trim().length > 0 ? rawAnswer.trim() : undefined;
    return { engine, ...(answer == null ? {} : { answer }), results };
  } finally {
    clearTimeout(timer);
  }
}
