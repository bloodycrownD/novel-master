/**
 * curl 命令导入解析 + 明文密钥启发式检测（SPEC web-search-curl §5/§8）：
 * 双端新建自定义引擎页共用同一实现。
 *
 * - `parseCurlCommand` 是纯解析：支持 `-X` / `-H` / `-d` / `--data-raw` / `-G`
 *   基本形态，识别出的疑似密钥值替换为 `{{apiKey}}` 占位符并随草稿单独携带，
 *   密钥真正落 SKSP 发生在保存时（PRD 验收时序随 spec 修订）。
 * - `findPlaintextSecrets` 是密钥检测的**全仓唯一实现**：`parseCurlCommand` 的
 *   密钥识别与保存路径的模板校验（`search-config`）调用同一函数，正反例随常量
 *   落定（正例：`sk-` 前缀 token、`Bearer` 后 ≥20 字符、`X-API-KEY` /
 *   `X-Subscription-Token` 赋值形态；反例：`{{apiKey}}` 占位符自身、短 token）。
 *
 * @module domain/tool/builtin/search/curl-import
 */

import type { MessageDescriptor } from "@/common/i18n.js";
import { Result } from "@/errors/either.js";
import type { CoreMessageKey } from "@/i18n/keys.js";

/** curl 解析成功后的表单草稿（method/url/headers/defaultBody 预填；响应映射配置已废除，无需补填）。 */
export interface CurlCommandDraft {
  readonly method: "GET" | "POST";
  /** 请求 URL（含 `-G` 时已并入 data 查询串）。 */
  readonly url: string;
  /** 请求头；疑似密钥值已替换为 `{{apiKey}}`。 */
  readonly headers: Readonly<Record<string, string>>;
  /** 请求体原文（`-d` / `--data-raw`；疑似密钥值已替换为 `{{apiKey}}`；预填模板 defaultBody）。 */
  readonly defaultBody?: string;
  /** 识别出的明文密钥值（保存时落 SKSP；模板里只有 `{{apiKey}}` 占位符）。 */
  readonly apiKey?: string;
}

/** curl 解析失败载荷（key `error.tool.search_curl_parse_failed`，params 带原因）。 */
export interface CurlParseError {
  readonly message: MessageDescriptor<CoreMessageKey>;
}

/** `sk-` 前缀 token（OpenAI 系密钥形态；短至 3 字符也按密钥识别）。 */
const SK_TOKEN_PATTERN = /\bsk-[A-Za-z0-9_-]{3,}/g;

/** `Bearer` 后的长 token（≥20 字符；`{{apiKey}}` 含花括号天然不命中）。 */
const BEARER_TOKEN_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/gi;

/** 鉴权头 / 参数赋值形态：`Authorization`、`X-API-KEY`、`X-Subscription-Token`、`api_key` 等。 */
const ASSIGNMENT_SECRET_PATTERN = /(?:Authorization|X-API-Key|X-Subscription-Token|api[-_]?key|subscription-token)["']?\s*[:=]\s*["']?(?:Bearer\s+)?([A-Za-z0-9._~+/=-]{20,})/gi;

/**
 * 明文密钥启发式检测：返回文本中命中的密钥原文（去重、按出现序）。
 *
 * 只做形态识别，不判断有效性；调用方决定拒绝保存还是替换为占位符。
 */
export function findPlaintextSecrets(text: string): readonly string[] {
  const secrets: string[] = [];
  const collect = (value: string | undefined): void => {
    if (value != null && value.length > 0 && !secrets.includes(value)) secrets.push(value);
  };
  for (const match of text.matchAll(SK_TOKEN_PATTERN)) collect(match[0]);
  for (const match of text.matchAll(BEARER_TOKEN_PATTERN)) collect(match[1]);
  for (const match of text.matchAll(ASSIGNMENT_SECRET_PATTERN)) collect(match[1]);
  return secrets;
}

/** 把文本中所有命中的密钥值替换为 `{{apiKey}}`。 */
function replaceSecrets(text: string, secrets: readonly string[]): string {
  let replaced = text;
  for (const secret of secrets) replaced = replaced.split(secret).join("{{apiKey}}");
  return replaced;
}

/** 取 `-X` / `--request` 等带值选项的下一个 token（缺值返回 undefined）。 */
function readOptionValue(tokens: readonly string[], index: number): string | undefined {
  return tokens[index + 1];
}

/**
 * 解析一条 curl 命令为表单草稿（纯解析，不写 KKV / SKSP）。
 *
 * 支持选项：`-X` / `--request`、`-H` / `--header`、`-d` / `--data` /
 * `--data-raw` / `--data-binary`、`-G` / `--get`、`--url`；其余选项整体拒绝
 * （不做半填）。`-G` 时 data 并入 URL 查询串、method 归 GET；`-d` 与无 `-X`
 * 时 method 缺省 POST。headers / body / url 中的疑似密钥值统一识别并替换为
 * `{{apiKey}}`，明文随 `apiKey` 字段携带。
 *
 * 分词支持单 / 双引号、反斜杠转义与反斜杠换行续行；引号未闭合整体失败。
 *
 * nm-style: keep-public — spec §8 双端共用的 curl 解析入口（desktop / mobile 新建页直接消费）。
 */
export function parseCurlCommand(text: string): Result<CurlCommandDraft, CurlParseError> {
  const fail = (reason: string): Result<CurlCommandDraft, CurlParseError> => Result.err({ message: { key: "error.tool.search_curl_parse_failed", params: { reason } } });
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === "\\") {
        const next = text[index + 1];
        if (next == null) return fail("unterminated escape in double-quoted string");
        index += 1;
        if (next === "\n") continue;
        if (next === "\r" && text[index + 1] === "\n") {
          index += 1;
          continue;
        }
        current += next;
        continue;
      }
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === "\\") {
      const next = text[index + 1];
      if (next == null) {
        current += char;
        started = true;
        continue;
      }
      index += 1;
      if (next === "\n") continue;
      if (next === "\r" && text[index + 1] === "\n") {
        index += 1;
        continue;
      }
      current += next;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (quote != null) return fail(quote === "'" ? "unterminated single quote" : "unterminated double quote");
  if (started) tokens.push(current);
  if (tokens.length === 0) return fail("empty command");
  const executable = tokens[0].split(/[\\/]/).pop()?.toLowerCase();
  if (executable !== "curl" && executable !== "curl.exe") return fail("command must start with curl");

  let method: string | undefined;
  let url: string | undefined;
  let data: string | undefined;
  let getForm = false;
  const headerPairs: { readonly name: string; readonly value: string }[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    switch (token) {
      case "-X":
      case "--request": {
        const value = readOptionValue(tokens, index);
        if (value == null) return fail(`missing value for ${token}`);
        method = value;
        index += 1;
        break;
      }
      case "-H":
      case "--header": {
        const value = readOptionValue(tokens, index);
        if (value == null) return fail(`missing value for ${token}`);
        const separator = value.indexOf(":");
        if (separator <= 0) return fail(`invalid header (expected "Name: Value"): ${value}`);
        headerPairs.push({ name: value.slice(0, separator).trim(), value: value.slice(separator + 1).trim() });
        index += 1;
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary": {
        const value = readOptionValue(tokens, index);
        if (value == null) return fail(`missing value for ${token}`);
        data = data == null ? value : `${data}&${value}`;
        index += 1;
        break;
      }
      case "-G":
      case "--get":
        getForm = true;
        break;
      case "--url": {
        const value = readOptionValue(tokens, index);
        if (value == null) return fail(`missing value for ${token}`);
        url = value;
        index += 1;
        break;
      }
      default:
        if (token.startsWith("-")) return fail(`unsupported option: ${token}`);
        if (url != null) return fail(`unexpected argument: ${token}`);
        url = token;
    }
  }

  if (url == null || url.trim().length === 0) return fail("missing request URL");
  if (getForm) {
    if (method != null && method.toUpperCase() !== "GET") return fail("-G conflicts with a non-GET -X method");
    method = "GET";
    if (data != null && data.length > 0) url = `${url}${url.includes("?") ? "&" : "?"}${data}`;
    data = undefined;
  }
  const normalizedMethod = (method ?? (data == null ? "GET" : "POST")).toUpperCase();
  if (normalizedMethod !== "GET" && normalizedMethod !== "POST") return fail(`unsupported method: ${normalizedMethod} (only GET / POST)`);
  if (normalizedMethod === "GET" && data != null) return fail("GET requests cannot carry a body (use -G to convert -d into query parameters)");

  const secrets: string[] = [];
  const collectSecrets = (candidates: readonly string[]): void => {
    for (const secret of candidates) if (!secrets.includes(secret)) secrets.push(secret);
  };
  collectSecrets(findPlaintextSecrets(url));
  for (const header of headerPairs) {
    collectSecrets(findPlaintextSecrets(`${header.name}: ${header.value}`));
  }
  if (data != null) collectSecrets(findPlaintextSecrets(data));
  if (secrets.length > 1) return fail("multiple distinct plaintext secrets detected; import them one at a time");

  const headers: Record<string, string> = {};
  for (const header of headerPairs) headers[header.name] = replaceSecrets(header.value, secrets);
  const replacedUrl = replaceSecrets(url, secrets);
  const replacedBody = data == null ? undefined : replaceSecrets(data, secrets);
  return Result.ok({ method: normalizedMethod, url: replacedUrl, headers, ...(replacedBody == null ? {} : { defaultBody: replacedBody }), ...(secrets.length === 0 ? {} : { apiKey: secrets[0] }) });
}
