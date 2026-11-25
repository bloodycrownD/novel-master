/**
 * MCP 失败分类器（spec §四四层判定）：status → contentType → body 形状 →
 * isError 文本嗅探。内部 kind 只有 7 个、不细分厂商标码；detail 永远带原文
 * （JSON 截 2KB；HTML 取 `<title>` 再接正文前 200 字符，整体钳 2KB）。
 *
 * kind → action 固定映射：auth → reauthorize（配了 bearer 时 fix-config，经
 * {@link McpFailureClassifier.actionForKind} 由知道 auth 配置的调用方细化）；
 * permission → fix-config；rate-limit / server / network → retry；
 * protocol / unknown → report。
 *
 * @module domain/mcp/logic/classify-mcp-failure
 */

import { Coerce } from "@/common/coerce.js";
import { Guards } from "@/common/guards.js";
import { Json } from "@/common/json.js";
import { Text } from "@/common/text.js";
import type { McpFailure, McpFailureAction, McpFailureKind } from "../model/mcp-failure.js";
import type { McpAuthType } from "../model/mcp-server-config.js";

/** `classify` 入参：一次 HTTP 响应（或 CallToolResult 原文）的分类现场。 */
export interface McpFailureClassifyParams {
    readonly status?: number;
    readonly contentType?: string | null;
    readonly body: string;
    readonly wwwAuthenticate?: string | null;
}

/** detail 的字节上限（JSON 截 2KB；HTML 拼完后同样钳到这里）。 */
const DETAIL_MAX_BYTES = 2048;

/** HTML 正文取前 200 字符。 */
const HTML_BODY_PREFIX_CHARS = 200;

/** HTML `<title>` 提取（自闭合属性容忍，标题内不含标签）。 */
const TITLE_PATTERN = /<title[^>]*>([^<]*)<\/title>/i;

/** detail 组装：统一钳 2KB（原文永不丢——截断的是长度，不是内容通道）。 */
const detailFrom = (text: string): string => Text.sliceUtf8Bytes(text, DETAIL_MAX_BYTES);

/** 失败构造（action 走 {@link McpFailureClassifier.actionForKind} 固定映射；status 可选）。 */
const buildFailure = (kind: McpFailureKind, detail: string, status: number | undefined): McpFailure =>
    ({kind, action: McpFailureClassifier.actionForKind(kind), detail, ...(status === undefined ? {} : {status})});

/** isError 文本的鉴权失败措辞（spec §四第 4 层，T-M9 锁定口径）。 */
const AUTH_TEXT_PATTERN = /401|unauthorized|invalid.?token|expired|credential|api.?key|forbidden/i;

export const McpFailureClassifier = {
    /**
     * 四层判定入口（params 对象入参）：401/403/429/5xx 按状态直判；2xx 非
     * json / event-stream 按网关错误页判；body 按 JSON-RPC 或业务码形状判；
     * 最后 isError 文本嗅探升级 auth / permission，都不命中回 unknown/report。
     */
    classify: (p: McpFailureClassifyParams): McpFailure => {
        if (p.status === 401) {
            const detail = p.wwwAuthenticate != null && p.wwwAuthenticate !== "" ? detailFrom(p.wwwAuthenticate) : detailFrom(p.body);
            return buildFailure("auth", detail, p.status);
        }
        if (p.status === 403) return buildFailure("permission", detailFrom(p.body), p.status);
        if (p.status === 429) return buildFailure("rate-limit", detailFrom(p.body), p.status);
        if (p.status !== undefined && p.status >= 500) return buildFailure("server", detailFrom(p.body), p.status);
        const contentType = (p.contentType ?? "").toLowerCase();
        if (p.status !== undefined && p.status >= 200 && p.status < 300 && !contentType.includes("json") && !contentType.includes("event-stream")) {
            // 第 2 层：2xx 非 json / event-stream → 网关错误页（`<title>` + 正文前 200 字符）。
            const title = TITLE_PATTERN.exec(p.body)?.[1]?.trim() ?? "";
            const prefix = p.body.slice(0, HTML_BODY_PREFIX_CHARS);
            return buildFailure("server", detailFrom(title === "" ? prefix : `${title}\n${prefix}`), p.status);
        }
        // 第 3 层：body 形状——标准 JSON-RPC（有 jsonrpc 字段）优先于业务码形状。
        const parsed = Json.parseText(p.body);
        if (parsed.ok && Guards.isRecord(parsed.value)) {
            const body = parsed.value;
            if ("jsonrpc" in body) {
                return buildFailure(Coerce.strictNumber(Guards.isRecord(body.error) ? body.error.code : undefined) === -32603 ? "server" : "protocol", detailFrom(p.body), p.status);
            }
            const businessCode = Coerce.strictNumber(body.code) ?? Coerce.strictNumber(Guards.isRecord(body.error) ? body.error.code : undefined) ?? Coerce.strictNumber(body.error_code);
            if (businessCode != null) {
                return buildFailure(businessCode === 401 ? "auth" : businessCode === 403 ? "permission" : businessCode === 429 ? "rate-limit" : "server", detailFrom(p.body), p.status);
            }
        }
        // 第 4 层：isError 文本嗅探升级（forbidden 措辞归 permission，其余 auth）。
        if (AUTH_TEXT_PATTERN.test(p.body)) return buildFailure(/forbidden/i.test(p.body) ? "permission" : "auth", detailFrom(p.body), p.status);
        return buildFailure("unknown", detailFrom(p.body), p.status);
    },

    /**
     * kind → action 固定映射（spec §四）；知道 server 鉴权配置的调用方传
     * `authType` 细化 auth 的去向（bearer → fix-config，其余 → reauthorize）。
     */
    actionForKind: (kind: McpFailureKind, authType?: McpAuthType): McpFailureAction =>
        kind === "auth" ? (authType === "bearer" ? "fix-config" : "reauthorize")
            : kind === "permission" ? "fix-config"
                : kind === "rate-limit" || kind === "server" || kind === "network" ? "retry"
                    : "report",
} as const;
