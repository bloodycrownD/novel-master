/**
 * 模板搜索执行器（SPEC web-search-curl v2 透传改造，全仓唯一的模板求值实现）。
 *
 * 流程：占位符替换（URL 仅 `{{query}}` 百分号编码；headers 原样内插；defaultBody 先
 * JSON.parse 再结构化遍历字符串值，整值 `"{{count}}"` 替换为 number，不做文本级
 * 替换——query 含引号/反斜杠天然安全）→ GET 用 URLSearchParams 合并 params
 * （追加/覆盖同名 query 参数）、POST 浅合并 `{ ...替换后 defaultBody, ...params }`
 * （同名以 params 为准；两者均空 → POST `{}`）→ fetch（统一 30s AbortController
 * 超时）→ 非 2xx 走 engineApiErrorMessage（body 前 300 字符 + redactSecret 脱敏）
 * → JSON parse → 递归提取**最长的对象数组**（全部元素为 object 的数组，平局取
 * 先出现；空数组 = 成功空结果）→ 50KB 预算内 JSON.stringify 截断为文本回流。
 *
 * 链降级判据（v2 §2 坍缩三条）：HTTP 非 2xx / 超时与网络错 / **响应无对象数组**。
 * 最后一条天然涵盖 bocha「HTTP 200 + body code 401」类业务码失败——失败响应里没有
 * 结果数组；抛错时错误文案附带整响应 JSON 的脱敏摘录（截断口径与 HTTP 错误一致），
 * 供 agent / 用户诊断引擎侧失败原因。2xx 且提取到数组 = 成功（数组短 / 空不降级，
 * agent 自己面对）。
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

import { utf8ByteLength } from "@/common/encoding.js";
import { isRecord } from "@/common/guards.js";
import { TOOL_OUTPUT_MAX_BYTES } from "@/domain/tool/logic/tool-output-limits.js";
import { engineApiErrorMessage, engineFailed, engineTimeoutError, normalizeMaxResults, redactSecret, SEARCH_TEMPLATE_PLACEHOLDER_PATTERN, type ResolvedEngineConfig, type SearchEngineTemplate, type SearchResponse, type SearchToolOptions } from "../types.js";

/** 占位符运行期取值：只有模板真的引用时才要求有值（未引用的可缺省）。 */
interface TemplatePlaceholderValues {
  readonly query: string;
  readonly count: number;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/** 模板引擎统一超时（毫秒）：全部模板共用 30s（AbortController + setTimeout，RN/Hermes 兼容）。 */
const TEMPLATE_ENGINE_TIMEOUT_MS = 30_000;

/** 提取文本超预算时追加的截断标注（文本不再保证是合法 JSON，标注让 agent 知情）。 */
const TRUNCATION_MARKER = `\n…[结果超 ${TOOL_OUTPUT_MAX_BYTES} 字节预算已截断]`;

/** 占位符内插：URL 传 encodeQuery（仅 `{{query}}` 百分号编码），headers/defaultBody 原样；displayName（template.name）进错误文案，引用缺值或未知占位符抛可读错误。 */
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

/**
 * 按模板发起一次搜索（单引擎请求；串行降级 / 120s 预算 / 50KB 落盘在 search-tool）。
 *
 * `template` 恒等 `resolved.template`（模板由 resolveEngineChain 携带，链解析是全仓
 * 唯一查模板点），分开传只为调用点可读。params 是工具层自由 JSON，原样透传引擎方言
 * 字段（GET 并入 query string、POST 浅合并覆盖 defaultBody 同名键）。成功返回
 * `results` 为提取结果的 JSON 文本（最长对象数组；50KB 预算内截断）。
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
    let parsedDefaultBody: Record<string, unknown> = {};
    if (template.defaultBody != null) {
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(template.defaultBody);
      } catch {
        throw engineFailed(`${template.name} template defaultBody is not valid JSON`);
      }
      if (!isRecord(parsedBody)) throw engineFailed(`${template.name} template defaultBody must be a JSON object`);
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
      parsedDefaultBody = parsedBody;
    }
    bodyText = JSON.stringify({ ...parsedDefaultBody, ...params });
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

    const responseText = await response.text();
    let raw: unknown;
    try {
      raw = JSON.parse(responseText);
    } catch (e) {
      throw engineFailed(`${template.name} API returned invalid JSON: ${redactSecret(e instanceof Error ? e.message : String(e), resolved.apiKey)}`);
    }

    // 递归提取最长的「对象数组」（全部元素为 object 才算候选；空数组也算命中 =
    // 成功空结果）：显式栈做深度先序遍历（子节点倒序入栈，数组按元素序、对象按
    // 键插入序），长度严格更长才替换，平局保留先出现；string[] 等非对象数组不算。
    let items: readonly unknown[] | undefined;
    const pending: unknown[] = [raw];
    while (pending.length > 0) {
      const node: unknown = pending.pop();
      if (Array.isArray(node)) {
        if (node.every((item) => isRecord(item)) && (items == null || node.length > items.length)) items = node;
        for (let index = node.length - 1; index >= 0; index -= 1) pending.push(node[index]);
        continue;
      }
      if (isRecord(node)) {
        const children = Object.values(node);
        for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
      }
    }
    if (items == null) {
      // 响应无对象数组：链降级失败（涵盖 bocha 业务码失败——失败响应里没有结果数组）。
      // 摘录整响应 JSON（脱敏后截 300 字符，口径同 HTTP 错误）供诊断引擎侧失败原因。
      throw engineFailed(`${template.name} API returned no results array: ${redactSecret(responseText, resolved.apiKey).slice(0, 300)}`);
    }
    // 提取文本按工具输出既有 50KB 字节预算截断：预算内原样透传；超预算逐码点累计
    //（不劈开多字节字符）切片，尾部追加截断标注（文本不再保证是合法 JSON，标注让 agent 知情）。
    const fullText = JSON.stringify(items);
    if (utf8ByteLength(fullText) <= TOOL_OUTPUT_MAX_BYTES) return { engine, results: fullText };
    let used = 0;
    let end = 0;
    for (const char of fullText) {
      const size = utf8ByteLength(char);
      if (used + size > TOOL_OUTPUT_MAX_BYTES) break;
      used += size;
      end += char.length;
    }
    return { engine, results: fullText.slice(0, end) + TRUNCATION_MARKER };
  } finally {
    clearTimeout(timer);
  }
}