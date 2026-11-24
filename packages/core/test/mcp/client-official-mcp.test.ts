import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AbortError } from "../../src/domain/abort/logic/create-abort-error.js";
import { OfficialMcpClient } from "../../src/infra/mcp/impl/official-mcp-client.js";
import type { McpHttpRequest, McpHttpResponse, McpRequestFn } from "../../src/infra/mcp/ports/mcp-transport.port.js";

const MCP_URL = "https://mcp.example.com/mcp";
const NEVER_ABORTED = new AbortController().signal;

/** ok：握手与工具请求正常；call-hang：tools/call 挂住直到中止；all-hang：握手就挂住。 */
type StubMode = "ok" | "call-hang" | "all-hang";

interface RecordedRequest {
    readonly method: string;
    readonly arguments_: unknown;
    readonly signal: AbortSignal | undefined;
}

const jsonReply = (id: number | string | undefined, result: unknown): McpHttpResponse => ({ status: 200, headers: { "content-type": "application/json" }, bodyText: JSON.stringify({ jsonrpc: "2.0", id, result }) });

interface Harness {
    readonly requestFn: McpRequestFn;
    readonly requests: readonly RecordedRequest[];
}

/** mock 请求函数只回 `{status, headers, bodyText}`（T-M16a 同款注入路径），中止以 AbortError reject——收割语义由适配层契约保证。 */
const makeHarness = (mode: StubMode): Harness => {
    const requests: RecordedRequest[] = [];
    const requestFn: McpRequestFn = async (request: McpHttpRequest): Promise<McpHttpResponse> => {
        const message = JSON.parse(request.body) as { id?: number | string; method: string; params?: { arguments?: unknown } };
        requests.push({ method: message.method, arguments_: message.params?.arguments, signal: request.signal });
        if (mode === "all-hang" || (mode === "call-hang" && message.method === "tools/call")) {
            return await new Promise<McpHttpResponse>((_resolve, reject) => {
                request.signal?.addEventListener("abort", () => reject(AbortError.create()), { once: true });
            });
        }
        if (message.method === "initialize") return jsonReply(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } });
        if (message.method === "notifications/initialized") return { status: 202, headers: {}, bodyText: "" };
        if (message.method === "tools/list") return jsonReply(message.id, { tools: [{ name: "read", description: "读一下", inputSchema: { type: "object", properties: {} } }, { name: "write", inputSchema: { type: "object", properties: {} } }] });
        if (message.method === "tools/call") return jsonReply(message.id, { content: [{ type: "text", text: "done" }], isError: false });
        return { status: 500, headers: { "content-type": "text/plain" }, bodyText: `mock: 未覆盖的方法 ${message.method}` };
    };
    return { requestFn, requests };
};

describe("OfficialMcpClient", () => {
    it("connect 走官方 legacy 握手，listTools 返回 name / description 窄投影", async () => {
        const harness = makeHarness("ok");
        const client = await OfficialMcpClient.connect({ url: MCP_URL, requestFn: harness.requestFn, timeoutMs: 5_000 }, NEVER_ABORTED);
        try {
            const tools = await client.listTools(NEVER_ABORTED);
            assert.deepEqual(tools, [{ name: "read", description: "读一下" }, { name: "write" }]);
            assert.equal(harness.requests[0]?.method, "initialize", "connect 先发 initialize 握手");
            assert.equal(harness.requests.some((request) => request.method === "notifications/initialized"), true);
        } finally {
            await client.close();
        }
    });

    it("callTool 原样返回 CallToolResult，入参进 arguments", async () => {
        const harness = makeHarness("ok");
        const client = await OfficialMcpClient.connect({ url: MCP_URL, requestFn: harness.requestFn, timeoutMs: 5_000 }, NEVER_ABORTED);
        try {
            const result = await client.callTool("read", { path: "a.txt" }, NEVER_ABORTED);
            assert.deepEqual(result, { content: [{ type: "text", text: "done" }], isError: false });
            const call = harness.requests.find((request) => request.method === "tools/call");
            assert.deepEqual(call?.arguments_, { path: "a.txt" });
        } finally {
            await client.close();
        }
    });

    it("callTool 的 signal 中止时原样以 AbortError reject，且在途请求被中止收割", async () => {
        const harness = makeHarness("call-hang");
        const client = await OfficialMcpClient.connect({ url: MCP_URL, requestFn: harness.requestFn, timeoutMs: 5_000 }, NEVER_ABORTED);
        try {
            const controller = new AbortController();
            const pending = client.callTool("slow", {}, controller.signal);
            const timer = setTimeout(() => controller.abort(), 100);
            try {
                await assert.rejects(pending, (error: unknown) => (error as Error).name === "AbortError");
            } finally {
                clearTimeout(timer);
            }
            const call = harness.requests.find((request) => request.method === "tools/call");
            assert.equal(call?.signal?.aborted, true, "中止的 signal 已并进 requestSignal（requestAbort 由适配层据此落地）");
        } finally {
            await client.close();
        }
    });

    it("握手挂住时 timeoutMs 到点 reject（单请求超时覆盖握手）", async () => {
        const harness = makeHarness("all-hang");
        const pending = OfficialMcpClient.connect({ url: MCP_URL, requestFn: harness.requestFn, timeoutMs: 100 }, NEVER_ABORTED);
        await assert.rejects(pending, /timed out/i);
        assert.equal(harness.requests[0]?.method, "initialize");
    });
});
