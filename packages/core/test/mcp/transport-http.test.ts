import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbortError } from "../../src/domain/abort/logic/create-abort-error.js";
import { HttpMcpTransport } from "../../src/infra/mcp/impl/http-mcp-transport.js";
import { McpTransportError } from "../../src/infra/mcp/ports/mcp-transport.port.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";

const MCP_URL = "https://mcp.example.com/mcp";

const initRequest: JSONRPCMessage = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "nm", version: "1" } } };
const listRequest: JSONRPCMessage = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const initResponse: JSONRPCMessage = { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test", version: "1" } } };
const listResponse: JSONRPCMessage = { jsonrpc: "2.0", id: 2, result: { tools: [] } };

/** mock 请求函数要回的一条响应：只有 {status, headers, bodyText}，没有流、没有 Response 对象。 */
interface MockReply {
    status: number;
    headers?: Record<string, string>;
    bodyText?: string;
    /** 配置了则以该错误 reject（模拟网络失败 / AbortError）。 */
    failWith?: Error;
}

/** mock 请求函数记录下来的单次请求。 */
interface RecordedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
}

interface Harness {
    transport: HttpMcpTransport;
    requests: RecordedRequest[];
    messages: JSONRPCMessage[];
    errors: Error[];
}

/**
 * T-M16a 的核心：mock 请求函数只回 `{status, headers, bodyText}`（模拟移动端原生
 * `request` 适配），本文件全部用例都走这一条注入路径，没有任何 `Response` / 流。
 */
function makeHarness(replies: MockReply[]): Harness {
    const requests: RecordedRequest[] = [];
    let index = 0;
    const transport = new HttpMcpTransport({
        url: MCP_URL,
        requestFn: async (request) => {
            requests.push({ url: request.url, method: request.method, headers: { ...request.headers }, body: request.body, signal: request.signal });
            const reply = replies[index];
            index += 1;
            if (reply === undefined) throw new Error("mock: 未配置对应的响应");
            if (reply.failWith !== undefined) throw reply.failWith;
            return { status: reply.status, headers: reply.headers ?? {}, bodyText: reply.bodyText ?? "" };
        },
    });
    const messages: JSONRPCMessage[] = [];
    const errors: Error[] = [];
    transport.onmessage = (message) => messages.push(message);
    transport.onerror = (error) => errors.push(error);
    return { transport, requests, messages, errors };
}

/** 捕获 send 的 reject 结果（node:assert 的 rejects 不返回实例，拿不到错误对象）。 */
function capture(promise: Promise<void>): Promise<unknown> {
    return promise.then(() => undefined, (error: unknown) => error);
}

/** 断言捕获结果是带 raw 的 McpTransportError 并返回它。 */
function assertTransportError(error: unknown): McpTransportError {
    assert.ok(error instanceof McpTransportError, `期望 McpTransportError，实际：${String(error)}`);
    return error;
}

const jsonReply = (body: string, headers?: Record<string, string>): MockReply => ({ status: 200, headers: { "content-type": "application/json", ...headers }, bodyText: body });
const sseReply = (frames: string, headers?: Record<string, string>): MockReply => ({ status: 200, headers: { "content-type": "text/event-stream", ...headers }, bodyText: frames });
const frame = (message: JSONRPCMessage): string => `data: ${JSON.stringify(message)}\n\n`;

const messageId = (message: JSONRPCMessage | undefined): unknown => (message as { id?: unknown } | undefined)?.id;

describe("HttpMcpTransport T-M16 session / protocol version 的吸收与回带", () => {
    it("从响应头（键名全小写）吸收 Mcp-Session-Id 并在下一次请求回带", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify(initResponse), { "mcp-session-id": "sess-abc" }), jsonReply(JSON.stringify(listResponse))]);
        await harness.transport.send(initRequest);
        assert.equal(harness.transport.sessionId, "sess-abc");
        await harness.transport.send(listRequest);
        assert.equal(harness.requests[1]?.headers["Mcp-Session-Id"], "sess-abc");
    });

    it("从响应头吸收 MCP-Protocol-Version 并带回", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify(initResponse), { "mcp-protocol-version": "2025-06-18" }), jsonReply(JSON.stringify(listResponse))]);
        await harness.transport.send(initRequest);
        await harness.transport.send(listRequest);
        assert.equal(harness.requests[1]?.headers["MCP-Protocol-Version"], "2025-06-18");
    });

    it("setProtocolVersion（官方 initialize 后回调）设置的版本随请求带回", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify(listResponse))]);
        harness.transport.setProtocolVersion("2025-06-18");
        await harness.transport.send(listRequest);
        assert.equal(harness.requests[0]?.headers["MCP-Protocol-Version"], "2025-06-18");
    });

    it("initialize 前的首个请求不带 session 与版本头", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify(initResponse))]);
        await harness.transport.send(initRequest);
        const headers = harness.requests[0]?.headers ?? {};
        assert.equal("Mcp-Session-Id" in headers, false);
        assert.equal("MCP-Protocol-Version" in headers, false);
    });
});

describe("HttpMcpTransport 固定请求头", () => {
    it("每次请求带 Content-Type 与双类型 Accept", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify(initResponse))]);
        await harness.transport.send(initRequest);
        assert.equal(harness.requests[0]?.headers["Content-Type"], "application/json");
        assert.equal(harness.requests[0]?.headers["Accept"], "application/json, text/event-stream");
        assert.equal(harness.requests[0]?.method, "POST");
        assert.equal(harness.requests[0]?.url, MCP_URL);
    });

    it("构造时的 authToken 产出 Bearer 头，官方 send 附加头最优先", async () => {
        const requests: RecordedRequest[] = [];
        const transport = new HttpMcpTransport({
            url: MCP_URL,
            authToken: "tok-1",
            extraHeaders: { "X-Custom": "deps", "X-Param": "deps" },
            requestFn: async (request) => {
                requests.push({ url: request.url, method: request.method, headers: { ...request.headers }, body: request.body, signal: request.signal });
                return { status: 200, headers: { "content-type": "application/json" }, bodyText: JSON.stringify(listResponse) };
            },
        });
        transport.onmessage = () => {};
        await transport.send(listRequest, { headers: { "X-Param": "send" } });
        assert.equal(requests[0]?.headers["Authorization"], "Bearer tok-1");
        assert.equal(requests[0]?.headers["X-Custom"], "deps");
        assert.equal(requests[0]?.headers["X-Param"], "send");
    });
});

describe("HttpMcpTransport T-M17 解析失败带 raw 原文", () => {
    const longBody = `{"before":${"x".repeat(4096)},"after":"end"}`;

    it("JSON 语法坏帧：抛 McpTransportError，raw 的 body 完整保留", async () => {
        const harness = makeHarness([jsonReply("not json at all")]);
        const error = assertTransportError(await capture(harness.transport.send(listRequest)));
        assert.deepEqual(error.raw, { status: 200, contentType: "application/json", body: "not json at all" });
    });

    it("合法 JSON 但非 JSON-RPC 形状：同样抛带 raw 的错误", async () => {
        const harness = makeHarness([jsonReply('{"hello":"world"}')]);
        const error = assertTransportError(await capture(harness.transport.send(listRequest)));
        assert.equal(error.raw?.status, 200);
        assert.equal(error.raw?.body, '{"hello":"world"}');
    });

    it("超长响应体在 raw.body 里逐字节完整", async () => {
        const harness = makeHarness([jsonReply(longBody)]);
        const error = assertTransportError(await capture(harness.transport.send(listRequest)));
        assert.equal(error.raw?.body, longBody);
        assert.equal(error.raw?.body.length, longBody.length);
    });

    it("SSE 全为非法帧：抛带 raw 的错误", async () => {
        const harness = makeHarness([sseReply("data: {broken\n\n")]);
        const error = assertTransportError(await capture(harness.transport.send(listRequest)));
        assert.equal(error.raw?.contentType, "text/event-stream");
        assert.equal(error.raw?.body, "data: {broken\n\n");
    });

    it("非 2xx 不吞 body：raw 保留原文，401 附带 WWW-Authenticate", async () => {
        const wwwAuthenticate = 'Bearer resource_metadata="https://x/.well-known/oauth-authorization-server", error="invalid_token"';
        const harness = makeHarness([{ status: 401, headers: { "www-authenticate": wwwAuthenticate }, bodyText: "" }]);
        const error = assertTransportError(await capture(harness.transport.send(initRequest)));
        assert.equal(error.raw?.status, 401);
        assert.equal(error.raw?.body, "");
        assert.equal(error.wwwAuthenticate, wwwAuthenticate);
    });

    it("500 的 HTML 网关页原文进 raw", async () => {
        const html = "<html><title>502 Bad Gateway</title></html>";
        const harness = makeHarness([{ status: 500, headers: { "content-type": "text/html" }, bodyText: html }]);
        const error = assertTransportError(await capture(harness.transport.send(listRequest)));
        assert.equal(error.raw?.status, 500);
        assert.equal(error.raw?.body, html);
    });

    it("2xx 但 content-type 不支持：抛带 raw 的错误", async () => {
        const harness = makeHarness([{ status: 200, headers: { "content-type": "text/html" }, bodyText: "<html>ok</html>" }]);
        const error = assertTransportError(await capture(harness.transport.send(listRequest)));
        assert.equal(error.raw?.contentType, "text/html");
        assert.match(error.message, /Unsupported MCP response content-type/);
    });
});

describe("HttpMcpTransport 响应投递", () => {
    it("JSON 单条响应经 onmessage 投递", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify(listResponse))]);
        await harness.transport.send(listRequest);
        assert.equal(harness.messages.length, 1);
        assert.equal(messageId(harness.messages[0]), 2);
    });

    it("JSON 数组响应逐条投递", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify([listResponse, initResponse]))]);
        await harness.transport.send(listRequest);
        assert.deepEqual(harness.messages.map(messageId), [2, 1]);
    });

    it("202 空体（通知响应）正常结束、无消息", async () => {
        const harness = makeHarness([{ status: 202 }]);
        await harness.transport.send(listRequest);
        assert.equal(harness.messages.length, 0);
        assert.equal(harness.errors.length, 0);
    });

    it("SSE 多帧一次投出（含注释行）", async () => {
        const body = `: keep-alive\n${frame(listResponse)}${frame(initResponse)}`;
        const harness = makeHarness([sseReply(body)]);
        await harness.transport.send(listRequest);
        assert.deepEqual(harness.messages.map(messageId), [2, 1]);
        assert.equal(harness.errors.length, 0);
    });

    it("SSE 流中夹非法帧：合法帧照常投递、非法帧经 onerror 上报、send 不 reject", async () => {
        const body = `${frame(listResponse)}data: {broken\n\n${frame(initResponse)}`;
        const harness = makeHarness([sseReply(body)]);
        await harness.transport.send(listRequest);
        assert.deepEqual(harness.messages.map(messageId), [2, 1]);
        assert.equal(harness.errors.length, 1);
        assert.match(harness.errors[0]?.message ?? "", /\{broken/);
    });
});

describe("HttpMcpTransport 中止与请求函数失败", () => {
    it("适配器对已中止 signal reject AbortError 时 transport 不发出请求且原样透传", async () => {
        const controller = new AbortController();
        controller.abort();
        const requests: RecordedRequest[] = [];
        const transport = new HttpMcpTransport({
            url: MCP_URL,
            requestFn: async (request) => {
                requests.push({ url: request.url, method: request.method, headers: { ...request.headers }, body: request.body, signal: request.signal });
                if (request.signal?.aborted === true) throw AbortError.create();
                return { status: 200, headers: { "content-type": "application/json" }, bodyText: JSON.stringify(listResponse) };
            },
        });
        transport.onmessage = () => {};
        const error = await capture(transport.send(listRequest, { requestSignal: controller.signal }));
        assert.ok(error instanceof Error && error.name === "AbortError", `期望 AbortError，实际：${String(error)}`);
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.signal, controller.signal);
    });

    it("请求函数 reject 的 AbortError 原样透传（不包成 McpTransportError）", async () => {
        const harness = makeHarness([{ status: 0, failWith: AbortError.create() }]);
        const error = await capture(harness.transport.send(listRequest));
        assert.ok(error instanceof Error && error.name === "AbortError", `期望 AbortError，实际：${String(error)}`);
    });

    it("请求函数的其他失败包成 McpTransportError（raw 为 null）", async () => {
        const harness = makeHarness([{ status: 0, failWith: new TypeError("fetch failed") }]);
        const error = assertTransportError(await capture(harness.transport.send(listRequest)));
        assert.equal(error.raw, null);
        assert.match(error.message, /fetch failed/);
    });
});

describe("HttpMcpTransport 生命周期", () => {
    it("start 是 no-op；close 触发 onclose 并清掉 session", async () => {
        const harness = makeHarness([jsonReply(JSON.stringify(initResponse), { "mcp-session-id": "sess-abc" })]);
        await harness.transport.start();
        await harness.transport.send(initRequest);
        let closed = false;
        harness.transport.onclose = () => {
            closed = true;
        };
        await harness.transport.close();
        assert.ok(closed);
        assert.equal(harness.transport.sessionId, undefined);
    });
});
