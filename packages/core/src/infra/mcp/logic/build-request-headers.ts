/**
 * MCP 请求头构造与响应头读取（认证 + session + protocol version）。
 *
 * `build` 的输出顺序：固定 Accept/Content-Type → 认证 → session → 协议版本 → 自定义头
 * （自定义头最后合并，可覆盖默认）。`pick` 做大小写不敏感查头——服务器与移动端原生
 * `request` 回传的键名大小写不做假设。
 *
 * @module infra/mcp/logic/build-request-headers
 */

export interface McpRequestHeaderParams {
    /** 已解析的 bearer / OAuth access token；空值不带 Authorization。 */
    readonly authToken?: string | null;
    /** 服务器下发的会话 id；空值不带 Mcp-Session-Id。 */
    readonly sessionId?: string | null;
    /** initialize 协商出的协议版本；空值不带 MCP-Protocol-Version（initialize 请求本身在 body 里协商）。 */
    readonly protocolVersion?: string | null;
    /** 用户自定义头（SKSP `mcp/{serverId}/headers`），最后合并。 */
    readonly extraHeaders?: Readonly<Record<string, string>>;
}

export const McpRequestHeaders = {
    /** 构造一次 Streamable HTTP 请求的头表。 */
    build(params: McpRequestHeaderParams): Record<string, string> {
        const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
        if (params.authToken) headers["Authorization"] = `Bearer ${params.authToken}`;
        if (params.sessionId) headers["Mcp-Session-Id"] = params.sessionId;
        if (params.protocolVersion) headers["MCP-Protocol-Version"] = params.protocolVersion;
        return { ...headers, ...params.extraHeaders };
    },

    /** 大小写不敏感查头；没有返回 null。 */
    pick(headers: Readonly<Record<string, string>>, name: string): string | null {
        const lower = name.toLowerCase();
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === lower) return value;
        }
        return null;
    },
} as const;
