/**
 * MCP 配置解析：外部 JSON / KKV 存储值 → 归一配置列表（spec §七、Step 1/11）。
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
 * - 外部 `headers.Authorization: "Bearer x"` 识别为 bearer：配置只存 SKSP ref
 *   （`McpSecretRefs.bearer(id)`），明文经 {@link McpServerParseOutcome.bearerPlain}
 *   交给调用方写 SKSP——本模块是纯函数，不做任何 IO。
 *
 * @module domain/mcp/logic/parse-mcp-server-config
 */

import { Coerce } from "@/common/coerce.js";
import { Guards } from "@/common/guards.js";
import { Json } from "@/common/json.js";
import { MCP_DEFAULT_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS } from "../model/mcp-server-config.js";
import type { McpServerConfig, McpTransportConfig, McpTransportType } from "../model/mcp-server-config.js";
import { McpSecretRefs } from "../ports/mcp-config-store.port.js";

/** 单个 server 的解析产物：归一配置 + 识别出的 bearer 明文（调用方写 SKSP，KKV 只存 ref）。 */
export interface McpServerParseOutcome {
    readonly config: McpServerConfig;
    /** 外部 `headers.Authorization` 识别出的明文；无识别时不存在。 */
    readonly bearerPlain?: string;
}

/** type 别名表（大小写不敏感；spec §七）。 */
const TYPE_ALIASES: Readonly<Record<string, McpTransportType>> = {
    http: "http",
    streamablehttp: "http",
    "streamable-http": "http",
    streamable_http: "http",
    stdio: "stdio",
    sse: "sse",
};

/** Authorization 头的 Bearer 值提取（scheme 大小写不敏感）。 */
const BEARER_VALUE_PATTERN = /^bearer\s+(.+)$/i;

/** 归一单条 server 配置；id 缺失 / 类型认不出 / http·sse 缺 url 的条目跳过（返回 null）。 */
const normalizeServer = (entry: unknown, idFromKey: string | null): McpServerParseOutcome | null => {
    if (!Guards.isRecord(entry)) return null;
    const id = (Coerce.strictText(entry.id) ?? idFromKey)?.trim() ?? "";
    if (id === "") return null;
    const name = (Coerce.strictText(entry.name) ?? idFromKey ?? id).trim() || id;
    const transportRecord = Guards.isRecord(entry.transport) ? entry.transport : null;
    const url = (Coerce.strictText(transportRecord?.url ?? entry.url) ?? "").trim();
    // type 归一：显式 type 查别名表（大小写不敏感）；缺 type 按 Claude Desktop 形态推断（command → stdio、url → http）。
    const typeText = Coerce.strictText(transportRecord?.type ?? entry.type);
    const type = typeText != null ? TYPE_ALIASES[typeText.trim().toLowerCase()] ?? null : Coerce.strictText(transportRecord?.command ?? entry.command) != null ? "stdio" : url !== "" ? "http" : null;
    if (type == null) return null;
    if (type !== "stdio" && url === "") return null;
    const transport: McpTransportConfig = type === "stdio" ? {type: "stdio"} : type === "sse" ? {type: "sse", url} : {type: "http", url};
    // 0 / 负数钳到下限（原生层对 <= 0 会落回 600 秒默认预算）；非数字回缺省。
    const timeoutRaw = Coerce.number(entry.timeoutMs);
    const timeoutMs = timeoutRaw === undefined ? MCP_DEFAULT_TIMEOUT_MS : Math.max(MCP_MIN_TIMEOUT_MS, timeoutRaw);
    // auth：存储形态优先（已导入过的配置原样保留 ref），再识别外部 headers.Authorization（Bearer scheme、键名大小写不敏感）。
    const storedAuth = Guards.isRecord(entry.auth) ? entry.auth : null;
    const storedAuthType = Coerce.strictText(storedAuth?.type);
    const secretRef = storedAuthType === "bearer" ? (Coerce.strictText(storedAuth?.secretRef)?.trim() ?? null) : null;
    let headerBearer: string | null = null;
    if (secretRef == null && storedAuthType !== "oauth" && Guards.isRecord(entry.headers)) {
        for (const [key, value] of Object.entries(entry.headers)) {
            if (key.toLowerCase() !== "authorization") continue;
            const matched = BEARER_VALUE_PATTERN.exec(Coerce.string(value).trim());
            if (matched) {
                headerBearer = matched[1]!.trim();
                break;
            }
        }
    }
    const config: McpServerConfig = {
        id,
        name,
        enabled: entry.enabled !== false,
        transport,
        timeoutMs,
        auth: storedAuthType === "oauth" ? {type: "oauth"} : secretRef != null ? {type: "bearer", secretRef} : headerBearer != null ? {type: "bearer", secretRef: McpSecretRefs.bearer(id)} : {type: "none"},
    };
    return headerBearer == null ? {config} : {config, bearerPlain: headerBearer};
};

export const McpConfigParser = {
    /**
     * 解析原始载荷（KKV 存储字符串 / 已解析的配置数组 / Claude Desktop 格式的
     * `{mcpServers:{...}}`）。容错归一，永不 throw：损坏 JSON 回缺省（空列表），
     * 非法条目跳过，缺 enabled 视为启用。
     */
    parse: (raw: unknown): readonly McpServerParseOutcome[] => {
        if (typeof raw === "string") {
            const parsed = Json.parseText(raw);
            return parsed.ok ? McpConfigParser.parse(parsed.value) : [];
        }
        if (Array.isArray(raw)) return raw.map((entry) => normalizeServer(entry, null)).filter((outcome): outcome is McpServerParseOutcome => outcome != null);
        if (Guards.isRecord(raw) && Guards.isRecord(raw.mcpServers)) {
            return Object.entries(raw.mcpServers)
                .map(([key, entry]) => normalizeServer(entry, key))
                .filter((outcome): outcome is McpServerParseOutcome => outcome != null);
        }
        return [];
    },
} as const;
