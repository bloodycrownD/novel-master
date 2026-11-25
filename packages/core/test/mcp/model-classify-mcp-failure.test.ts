import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Encoding } from "../../src/common/encoding.js";
import { McpFailureClassifier } from "../../src/domain/mcp/logic/classify-mcp-failure.js";
import { McpFailureOps } from "../../src/domain/mcp/model/mcp-failure.js";

describe("classify-mcp-failure", () => {
    it("T-M5: 智谱式 200 + {code:401} 业务码 → auth / reauthorize，detail 含原文", () => {
        const failure = McpFailureClassifier.classify({status: 200, contentType: "application/json", body: '{"code":401,"msg":"令牌已过期"}', wwwAuthenticate: null});
        assert.equal(failure.kind, "auth");
        assert.equal(failure.action, "reauthorize");
        assert.ok(failure.detail.includes("令牌已过期"));
        assert.ok(failure.detail.includes("401"));
        assert.equal(failure.status, 200);
    });

    it("T-M6: 401 + WWW-Authenticate → auth，detail 取自 WWW-Authenticate 且非空", () => {
        const www = 'Bearer resource_metadata="https://x/.well-known/oauth-authorization-server", error="invalid_token"';
        const failure = McpFailureClassifier.classify({status: 401, contentType: null, body: "", wwwAuthenticate: www});
        assert.equal(failure.kind, "auth");
        assert.equal(failure.detail, www);
        assert.ok(failure.detail.length > 0);
        assert.equal(failure.status, 401);
        // 无 WWW-Authenticate 时 detail 回落 body 原文
        const fallback = McpFailureClassifier.classify({status: 401, contentType: null, body: "token expired long ago", wwwAuthenticate: null});
        assert.equal(fallback.kind, "auth");
        assert.ok(fallback.detail.includes("token expired"));
    });

    it("T-M6a: 智谱式 200 + {code:5001} 配额业务码 → server / retry，detail 含 5001", () => {
        const failure = McpFailureClassifier.classify({status: 200, contentType: "application/json", body: '{"code":5001,"msg":"quota exceeded"}'});
        assert.equal(failure.kind, "server");
        assert.equal(failure.action, "retry");
        assert.ok(failure.detail.includes("5001"));
    });

    it("T-M7: 200 + HTML 网关页 → server，detail 含 title 且整体 ≤ 2KB", () => {
        const body = `<html><head><title>502 Bad Gateway</title></head><body>${"填".repeat(3000)}</body></html>`;
        const failure = McpFailureClassifier.classify({status: 200, contentType: "text/html", body, wwwAuthenticate: null});
        assert.equal(failure.kind, "server");
        assert.ok(failure.detail.includes("502 Bad Gateway"));
        assert.ok(Encoding.utf8ByteLength(failure.detail) <= 2048);
        // 无 title 的 HTML → 正文前 200 字符兜底
        const noTitle = McpFailureClassifier.classify({status: 200, contentType: "text/html", body: "<html><body>oops</body></html>"});
        assert.equal(noTitle.kind, "server");
        assert.ok(noTitle.detail.includes("oops"));
    });

    it("T-M8: JSON-RPC error.code 按标准码映射，不被业务码形状误判", () => {
        const failure = McpFailureClassifier.classify({status: 200, contentType: "application/json", body: '{"jsonrpc":"2.0","error":{"code":-32601}}', wwwAuthenticate: null});
        assert.equal(failure.kind, "protocol");
        assert.equal(failure.action, "report");
        // -32603 → server / retry
        const internal = McpFailureClassifier.classify({status: 200, contentType: "application/json", body: '{"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal error"}}'});
        assert.equal(internal.kind, "server");
        assert.equal(internal.action, "retry");
        // 无 jsonrpc 字段的同名负数业务码不进 JSON-RPC 分支（业务码其余 → server）
        const business = McpFailureClassifier.classify({status: 200, contentType: "application/json", body: '{"code":-32601,"msg":"x"}'});
        assert.equal(business.kind, "server");
    });

    it("T-M9: looksLikeAuthFailure 的正/反例", () => {
        assert.equal(McpFailureClassifier.looksLikeAuthFailure("401 Bad credentials"), true);
        assert.equal(McpFailureClassifier.looksLikeAuthFailure("file not found"), false);
    });

    it("kind → action 固定映射（auth 配 bearer 时细化 fix-config）", () => {
        assert.equal(McpFailureClassifier.actionForKind("auth"), "reauthorize");
        assert.equal(McpFailureClassifier.actionForKind("auth", "oauth"), "reauthorize");
        assert.equal(McpFailureClassifier.actionForKind("auth", "bearer"), "fix-config");
        assert.equal(McpFailureClassifier.actionForKind("permission"), "fix-config");
        for (const kind of ["rate-limit", "server", "network"] as const) assert.equal(McpFailureClassifier.actionForKind(kind), "retry");
        for (const kind of ["protocol", "unknown"] as const) assert.equal(McpFailureClassifier.actionForKind(kind), "report");
    });

    it("status 直判与第 4 层嗅探升级", () => {
        assert.equal(McpFailureClassifier.classify({status: 403, body: "no scope"}).kind, "permission");
        assert.equal(McpFailureClassifier.classify({status: 429, body: "slow down"}).kind, "rate-limit");
        const server = McpFailureClassifier.classify({status: 503, body: "upstream hiccup"});
        assert.equal(server.kind, "server");
        assert.equal(server.action, "retry");
        assert.equal(server.status, 503);
        // 都不命中时嗅探升级：credential / forbidden 措辞
        assert.equal(McpFailureClassifier.classify({status: 200, contentType: "application/json", body: '{"msg":"your api key is invalid"}'}).kind, "auth");
        // 非 JSON 形状的 forbidden 措辞（text/plain 会被第 2 层网关页判定收走，这里走 json 通道验嗅探）
        assert.equal(McpFailureClassifier.classify({status: 200, contentType: "application/json", body: "forbidden"}).kind, "permission");
        // 什么都没有 → unknown / report，detail 保留原文
        const unknown = McpFailureClassifier.classify({status: 200, contentType: "application/json", body: '{"msg":"nothing matches"}'});
        assert.equal(unknown.kind, "unknown");
        assert.equal(unknown.action, "report");
        assert.ok(unknown.detail.includes("nothing matches"));
    });

    it("McpFailureOps.unsupportedTransport：stdio / sse 的固定失败形态（T-M11a 状态半共用）", () => {
        for (const [type, fragment] of [["stdio", "暂不支持 stdio"], ["sse", "暂不支持 SSE"]] as const) {
            const failure = McpFailureOps.unsupportedTransport(type);
            assert.equal(failure.kind, "server");
            assert.equal(failure.action, "fix-config");
            assert.ok(failure.detail.includes(fragment));
            assert.ok(failure.detail.includes("请改用 HTTP 传输"));
        }
    });
});
