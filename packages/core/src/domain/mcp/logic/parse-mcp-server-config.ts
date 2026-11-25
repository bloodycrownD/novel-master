/**
 * MCP 配置解析：KKV 存储值（JSON 字符串 / 已解析配置数组）→ 归一配置列表（spec §七）。
 *
 * 口径：
 * - 读路径容错（迁移口径与 search 一致）：未知字段丢弃（重建对象天然丢弃）、
 *   非法条目跳过、整体损坏（JSON 解析失败 / 形状不认识）回缺省 = 空列表；
 * - `type` 别名归一：`http` / `streamableHttp` / `streamable-http` /
 *   `streamable_http` → `http`；`stdio` → `stdio`；`sse` → `sse`；缺 type 时按
 *   Claude Desktop 形态推断（有 `command` → stdio、有 `url` → http）；
 * - stdio 只归一收成 `{type:"stdio"}`，`command` / `args` / `env` / `cwd` 丢弃，
 *   解析算成功（可用性判定在连接管理器）；
 * - `timeoutMs` 缺省 120000，且钳到 >= 1000；
 * - `description` 取条目的 description（字符串则用，否则空串），缺省不回 id。
 *
 * @module domain/mcp/logic/parse-mcp-server-config
 */

import { Coerce } from "@/common/coerce.js";
import { Guards } from "@/common/guards.js";
import { Json } from "@/common/json.js";
import { MCP_DEFAULT_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS } from "../model/mcp-server-config.js";
import type { McpAuthConfig, McpServerConfig, McpTransportConfig, McpTransportType } from "../model/mcp-server-config.js";

/** type 别名表（大小写不敏感；spec §七）。 */
const TYPE_ALIASES: Readonly<Record<string, McpTransportType>> = {
    http: "http",
    streamablehttp: "http",
    "streamable-http": "http",
    streamable_http: "http",
    stdio: "stdio",
    sse: "sse",
};

export const McpConfigParser = {
    /**
     * 解析 KKV 存储值（`servers` 键的 JSON 字符串 / 已解析的配置数组）。容错归一，
     * 永不 throw：损坏 JSON 回缺省（空列表），非法条目跳过，缺 enabled 视为启用。
     */
    // nm-style: keep-public — KKV 存储值的归一规则属领域纯函数，与 infra 的 IO 读通道分离；归一规则有独立的用例矩阵
    parse: (raw: unknown): readonly McpServerConfig[] => {
        if (typeof raw === "string") {
            const parsed = Json.parseText(raw);
            return parsed.ok ? McpConfigParser.parse(parsed.value) : [];
        }
        if (!Array.isArray(raw)) return [];
        // 单条归一：id 缺失 / 类型认不出 / http·sse 缺 url 的条目跳过（返回 null 被过滤）。
        return raw.map((entry: unknown): McpServerConfig | null => {
            if (!Guards.isRecord(entry)) return null;
            const id = Coerce.strictText(entry.id)?.trim() ?? "";
            if (id === "") return null;
            const description = Coerce.strictText(entry.description) ?? "";
            const transportRecord = Guards.isRecord(entry.transport) ? entry.transport : null;
            const url = (Coerce.strictText(transportRecord?.url ?? entry.url) ?? "").trim();
            // type 归一：显式 type 查别名表（大小写不敏感）；缺 type 按 Claude Desktop 形态推断（command → stdio、url → http）。
            const typeText = Coerce.strictText(transportRecord?.type ?? entry.type);
            let type: McpTransportType | null = null;
            if (typeText != null) {
                type = TYPE_ALIASES[typeText.trim().toLowerCase()] ?? null;
            } else if (Coerce.strictText(transportRecord?.command ?? entry.command) != null) {
                type = "stdio";
            } else if (url !== "") {
                type = "http";
            }
            if (type == null) return null;
            if (type !== "stdio" && url === "") return null;
            let transport: McpTransportConfig;
            if (type === "stdio") {
                transport = {type: "stdio"};
            } else if (type === "sse") {
                transport = {type: "sse", url};
            } else {
                transport = {type: "http", url};
            }
            // 0 / 负数钳到下限（原生层对 <= 0 会落回 600 秒默认预算）；非数字回缺省。
            const timeoutRaw = Coerce.number(entry.timeoutMs);
            const timeoutMs = timeoutRaw === undefined ? MCP_DEFAULT_TIMEOUT_MS : Math.max(MCP_MIN_TIMEOUT_MS, timeoutRaw);
            // auth：存储形态原样保留（bearer 的 ref / oauth / none），识别不出回 none。
            const storedAuth = Guards.isRecord(entry.auth) ? entry.auth : null;
            const storedAuthType = Coerce.strictText(storedAuth?.type);
            const secretRef = storedAuthType === "bearer" ? (Coerce.strictText(storedAuth?.secretRef)?.trim() ?? null) : null;
            let auth: McpAuthConfig;
            if (storedAuthType === "oauth") {
                auth = {type: "oauth"};
            } else if (secretRef != null) {
                auth = {type: "bearer", secretRef};
            } else {
                auth = {type: "none"};
            }
            return {
                id,
                description,
                enabled: entry.enabled !== false,
                transport,
                timeoutMs,
                auth,
            };
        }).filter((config): config is McpServerConfig => config != null);
    },

    /**
     * 解析 KKV 存储值（`disabledTools` 键的 JSON 字符串 / 已解析的对象）。容错归一，永不 throw：
     * 值不是字符串数组的条目跳过，整体损坏回空表（等价于全部工具启用）。
     */
    // nm-style: keep-public — 同 parse：存储值的归一规则属领域纯函数，与 infra 的 IO 读通道分离
    parseDisabledTools: (raw: unknown): Record<string, string[]> => {
        const text = typeof raw === "string" ? Json.parseText(raw) : null;
        // 非字符串（已解析的对象）原样判形状；字符串解析失败按损坏处理。
        let value: unknown = raw;
        if (text != null) {
            value = text.ok ? text.value : null;
        }
        if (!Guards.isRecord(value)) return {};
        return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((name) => typeof name === "string")));
    },
} as const;
