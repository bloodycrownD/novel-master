/**
 * 两端共享的 Streamable HTTP transport（POST-per-request、整包响应后解析）。
 *
 * 实现官方 `Transport` 接口（spec「三、HTTP transport」的 McpTransport 形状就是它的
 * 抄写版——官方 `Client.connect` 只认官方接口，`sessionId` 官方用 `string | undefined`
 * 而非 `string | null`，以官方为准）。不做 GET 推送流（spec：首版不需要），`start`
 * 是 no-op；`close` 不发 DELETE 终结会话，只触发 `onclose`。
 *
 * 每次请求的头表经 `McpRequestHeaders.build`（吸收到的 session 与协议版本自动带回；
 * 官方 Protocol 在 `initialize` 响应后调 `setProtocolVersion`）。请求经注入的
 * `McpRequestFn` 发出，中止以 `AbortError` reject 透传（契约在 McpRequestFn，适配器
 * 保证；transport 不包装）；非 2xx / 解析失败抛 `McpTransportError`，`raw` 带完整
 * 响应原文、401 时附带 `wwwAuthenticate`。
 *
 * @module infra/mcp/impl/http-mcp-transport
 */

import { parseJSONRPCMessage, serializeMessage, type JSONRPCMessage, type MessageExtraInfo, type Transport, type TransportSendOptions } from "@modelcontextprotocol/client";
import { McpRequestHeaders } from "@/infra/mcp/logic/build-request-headers.js";
import { ParseSseFrames } from "@/infra/mcp/logic/parse-sse-frames.js";
import { McpTransportError, type McpHttpRequest, type McpRequestFn, type RawMcpResponse } from "@/infra/mcp/ports/mcp-transport.port.js";
import { RequestAbort } from "@/infra/llm-protocol/logic/request-abort.js";

/** HttpMcpTransport 的装配依赖：目标端点 + 请求函数 + 可选认证与自定义头。 */
export interface HttpMcpTransportDeps {
    readonly url: string;
    readonly requestFn: McpRequestFn;
    readonly authToken?: string | null;
    readonly extraHeaders?: Readonly<Record<string, string>>;
}

export class HttpMcpTransport implements Transport {
    onclose?: (() => void) | undefined;
    onerror?: ((error: Error) => void) | undefined;
    onmessage?: (<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void) | undefined;
    private readonly deps: HttpMcpTransportDeps;
    private sessionIdValue: string | null = null;
    private protocolVersion: string | null = null;

    constructor(deps: HttpMcpTransportDeps) {
        this.deps = deps;
    }

    /** 官方 `Client.connect` 会在握手前隐式调用；POST-per-request 模型无需连接步骤。 */
    async start(): Promise<void> {}

    get sessionId(): string | undefined {
        return this.sessionIdValue ?? undefined;
    }

    /** nm-style: keep-public — 官方 Transport 接口实现；官方 Protocol 在 initialize 响应后回调，按名计数看不见运行时调用。 */
    setProtocolVersion(version: string): void {
        this.protocolVersion = version;
    }

    async close(): Promise<void> {
        this.sessionIdValue = null;
        this.protocolVersion = null;
        this.onclose?.();
    }

    async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
        const headers = McpRequestHeaders.build({ authToken: this.deps.authToken, sessionId: this.sessionIdValue, protocolVersion: this.protocolVersion, extraHeaders: options?.headers === undefined ? this.deps.extraHeaders : { ...this.deps.extraHeaders, ...options.headers } });
        const request: McpHttpRequest = { url: this.deps.url, method: "POST", headers, body: serializeMessage(message), signal: options?.requestSignal };
        let response: Awaited<ReturnType<McpRequestFn>>;
        try {
            response = await this.deps.requestFn(request);
        } catch (cause) {
            if (RequestAbort.isAbortLikeError(cause) || cause instanceof McpTransportError) throw cause;
            throw new McpTransportError(`MCP request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        const session = McpRequestHeaders.pick(response.headers, "Mcp-Session-Id");
        if (session !== null) this.sessionIdValue = session;
        const headerVersion = McpRequestHeaders.pick(response.headers, "MCP-Protocol-Version");
        if (headerVersion !== null) this.protocolVersion = headerVersion;
        const raw: RawMcpResponse = { status: response.status, contentType: McpRequestHeaders.pick(response.headers, "content-type"), body: response.bodyText };
        if (response.status < 200 || response.status >= 300) {
            throw new McpTransportError(`MCP server returned HTTP ${response.status}`, raw, McpRequestHeaders.pick(response.headers, "www-authenticate"));
        }
        const contentType = (raw.contentType ?? "").toLowerCase();
        if (contentType.startsWith("text/event-stream")) {
            const outcome = ParseSseFrames.parse(raw.body);
            for (const incoming of outcome.messages) this.onmessage?.(incoming);
            for (const badFrame of outcome.invalid) this.onerror?.(new Error(`MCP SSE frame is not a valid JSON-RPC message (${badFrame.error}); raw: ${badFrame.data}`));
            if (outcome.messages.length === 0 && outcome.invalid.length > 0) throw new McpTransportError("MCP SSE response contained no valid JSON-RPC frame", raw);
            return;
        }
        if (contentType.startsWith("application/json") && raw.body.trim() !== "") {
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw.body) as unknown;
            } catch {
                throw new McpTransportError("MCP response body is not valid JSON", raw);
            }
            let delivered = 0;
            let invalid = 0;
            for (const candidate of Array.isArray(parsed) ? parsed : [parsed]) {
                try {
                    this.onmessage?.(parseJSONRPCMessage(candidate));
                    delivered += 1;
                } catch (parseError) {
                    invalid += 1;
                    this.onerror?.(parseError instanceof Error ? parseError : new Error(String(parseError)));
                }
            }
            if (delivered === 0 && invalid > 0) throw new McpTransportError("MCP JSON response contained no valid JSON-RPC message", raw);
            return;
        }
        // 202/204 的通知响应没有 content-type 也没有 body，正常结束。
        if (raw.contentType === null && raw.body.trim() === "") return;
        throw new McpTransportError(`Unsupported MCP response content-type: ${raw.contentType ?? "(missing)"}`, raw);
    }
}
