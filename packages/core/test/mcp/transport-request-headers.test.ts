import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpRequestHeaders } from "../../src/infra/mcp/logic/build-request-headers.js";

describe("McpRequestHeaders.build", () => {
    it("固定携带 Content-Type 与双类型 Accept", () => {
        const headers = McpRequestHeaders.build({});
        assert.equal(headers["Content-Type"], "application/json");
        assert.equal(headers["Accept"], "application/json, text/event-stream");
    });

    it("authToken 产出 Bearer Authorization", () => {
        const headers = McpRequestHeaders.build({ authToken: "tok-1" });
        assert.equal(headers["Authorization"], "Bearer tok-1");
    });

    it("authToken 为空时不带 Authorization", () => {
        const headers = McpRequestHeaders.build({ authToken: null });
        assert.equal("Authorization" in headers, false);
    });

    it("sessionId 与 protocolVersion 分别落到 Mcp-Session-Id 与 MCP-Protocol-Version", () => {
        const headers = McpRequestHeaders.build({ sessionId: "sess-1", protocolVersion: "2025-06-18" });
        assert.equal(headers["Mcp-Session-Id"], "sess-1");
        assert.equal(headers["MCP-Protocol-Version"], "2025-06-18");
    });

    it("extraHeaders 最后合并，可覆盖默认头", () => {
        const headers = McpRequestHeaders.build({ extraHeaders: { "X-Custom": "v", "Accept": "application/json" } });
        assert.equal(headers["X-Custom"], "v");
        assert.equal(headers["Accept"], "application/json");
    });
});

describe("McpRequestHeaders.pick", () => {
    it("大小写不敏感命中", () => {
        assert.equal(McpRequestHeaders.pick({ "content-type": "application/json" }, "Content-Type"), "application/json");
        assert.equal(McpRequestHeaders.pick({ "MCP-Protocol-Version": "2025-06-18" }, "mcp-protocol-version"), "2025-06-18");
    });

    it("没有对应头时返回 null", () => {
        assert.equal(McpRequestHeaders.pick({ "content-type": "text/html" }, "Www-Authenticate"), null);
    });
});
