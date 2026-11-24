import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McpConfigParser } from "../../src/domain/mcp/logic/parse-mcp-server-config.js";
import { MCP_DEFAULT_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS, McpServerConfigOps } from "../../src/domain/mcp/model/mcp-server-config.js";
import { McpFailureOps } from "../../src/domain/mcp/model/mcp-failure.js";
import { McpSecretRefs } from "../../src/domain/mcp/ports/mcp-config-store.port.js";

describe("parse-mcp-server-config", () => {
    it("T-M1: 六种 type 写法归一（http / streamableHttp / streamable-http / streamable_http / stdio / sse）", () => {
        const outcomes = McpConfigParser.parse({mcpServers: {
            a: {type: "http", url: "https://a.example/mcp"},
            b: {type: "streamableHttp", url: "https://b.example/mcp"},
            c: {type: "streamable-http", url: "https://c.example/mcp"},
            d: {type: "streamable_http", url: "https://d.example/mcp"},
            e: {type: "stdio", command: "npx"},
            f: {type: "sse", url: "https://f.example/sse"},
        }});
        assert.equal(outcomes.length, 6);
        const byId = new Map(outcomes.map((outcome) => [outcome.config.id, outcome.config]));
        for (const id of ["a", "b", "c", "d"]) assert.equal(byId.get(id)?.transport.type, "http", `id=${id}`);
        assert.equal(byId.get("e")?.transport.type, "stdio");
        assert.equal(byId.get("f")?.transport.type, "sse");
        // 大小写不敏感
        const [mixed] = McpConfigParser.parse({mcpServers: {m: {type: "StreamableHTTP", url: "https://m.example/mcp"}}});
        assert.equal(mixed?.config.transport.type, "http");
    });

    it("T-M2: 外部 headers.Authorization 识别为 bearer——KKV 只存 ref，明文走 bearerPlain 由调用方写 SKSP", () => {
        const [outcome] = McpConfigParser.parse({mcpServers: {zapier: {url: "https://zapier.example/mcp", headers: {Authorization: "Bearer sk-secret-123"}}}});
        assert.equal(outcome?.config.auth.type, "bearer");
        assert.deepEqual(outcome?.config.auth, {type: "bearer", secretRef: McpSecretRefs.bearer("zapier")});
        assert.equal(outcome?.bearerPlain, "sk-secret-123");
        // 配置对象（KKV 存储形态）不含明文
        assert.equal(JSON.stringify(outcome?.config).includes("sk-secret-123"), false);
        // authorization 小写键同样识别
        const [lower] = McpConfigParser.parse({mcpServers: {z2: {url: "https://z2.example/mcp", headers: {authorization: "bearer lower-key"}}}});
        assert.equal(lower?.bearerPlain, "lower-key");
        // 非 Bearer scheme 不识别
        const [basic] = McpConfigParser.parse({mcpServers: {z3: {url: "https://z3.example/mcp", headers: {Authorization: "Basic dXNlcjpwYXNz"}}}});
        assert.deepEqual(basic?.config.auth, {type: "none"});
        assert.equal(basic?.bearerPlain, undefined);
    });

    it("T-M4: 缺 timeoutMs 补默认 120000；0 / 负数钳到 1000；未知字段丢弃；损坏 JSON 回缺省", () => {
        const [missing] = McpConfigParser.parse({mcpServers: {a: {url: "https://a.example/mcp"}}});
        assert.equal(missing?.config.timeoutMs, MCP_DEFAULT_TIMEOUT_MS);
        const [zero] = McpConfigParser.parse({mcpServers: {z: {type: "http", url: "https://z.example/mcp", timeoutMs: 0}}});
        assert.equal(zero?.config.timeoutMs, MCP_MIN_TIMEOUT_MS);
        const [negative] = McpConfigParser.parse([{id: "n", transport: {type: "http", url: "https://n.example/mcp"}, timeoutMs: -5}]);
        assert.equal(negative?.config.timeoutMs, MCP_MIN_TIMEOUT_MS);
        const [extra] = McpConfigParser.parse({mcpServers: {e: {type: "http", url: "https://e.example/mcp", vendorSpecific: "junk", nested: {deep: true}}}});
        assert.deepEqual(Object.keys(extra?.config ?? {}).sort(), ["auth", "enabled", "id", "name", "timeoutMs", "transport"]);
        assert.deepEqual(Object.keys(extra?.config.transport ?? {}), ["type", "url"]);
        // 损坏 JSON / 形状不认识 → 缺省（空列表）
        assert.deepEqual(McpConfigParser.parse("{broken json"), []);
        assert.deepEqual(McpConfigParser.parse("not json at all"), []);
        assert.deepEqual(McpConfigParser.parse(42), []);
        // 存储字符串（KKV 读出形态）可解析
        const [fromString] = McpConfigParser.parse(JSON.stringify([{id: "s", transport: {type: "http", url: "https://s.example/mcp"}}]));
        assert.equal(fromString?.config.transport.type, "http");
    });

    it("T-M11a(解析半): stdio 只归一收 {type:\"stdio\"}，command / args / env / cwd 丢弃，解析算成功", () => {
        const outcomes = McpConfigParser.parse({mcpServers: {fs: {command: "npx", args: ["-y", "fs-mcp"], env: {TOKEN: "x"}, cwd: "/tmp"}}});
        assert.equal(outcomes.length, 1);
        const config = outcomes[0]!.config;
        assert.deepEqual(config.transport, {type: "stdio"});
        const serialized = JSON.stringify(config);
        for (const leaked of ["npx", "fs-mcp", "TOKEN", "/tmp"]) assert.equal(serialized.includes(leaked), false, `不应残留 stdio 细节：${leaked}`);
    });

    it("T-M11a/T-M11b(纯函数半): stdio+http 混合按 isTransportSupported 过滤只剩 http，stdio 失败形态可读出", () => {
        const configs = McpConfigParser.parse({mcpServers: {local: {command: "npx"}, remote: {url: "https://remote.example/mcp"}}}).map((outcome) => outcome.config);
        const usable = configs.filter(McpServerConfigOps.isTransportSupported);
        assert.deepEqual(usable.map((config) => config.id), ["remote"]);
        const stdio = configs.find((config) => config.id === "local")!;
        const failure = McpFailureOps.unsupportedTransport(stdio.transport.type);
        assert.equal(failure.kind, "server");
        assert.equal(failure.action, "fix-config");
        assert.ok(failure.detail.includes("暂不支持 stdio"));
    });

    it("存储形态往返：enabled / name / auth 原样保留，缺省补齐", () => {
        const [disabled] = McpConfigParser.parse([{id: "off", name: "关着的", enabled: false, transport: {type: "http", url: "https://off.example/mcp"}}]);
        assert.equal(disabled?.config.enabled, false);
        assert.equal(disabled?.config.name, "关着的");
        assert.deepEqual(disabled?.config.auth, {type: "none"});
        const [storedBearer] = McpConfigParser.parse([{id: "s", transport: {type: "http", url: "https://s.example/mcp"}, auth: {type: "bearer", secretRef: "mcp/s/bearer"}}]);
        assert.deepEqual(storedBearer?.config.auth, {type: "bearer", secretRef: "mcp/s/bearer"});
        assert.equal(storedBearer?.bearerPlain, undefined);
        const [storedOAuth] = McpConfigParser.parse([{id: "o", transport: {type: "http", url: "https://o.example/mcp"}, auth: {type: "oauth"}}]);
        assert.deepEqual(storedOAuth?.config.auth, {type: "oauth"});
        // Claude Desktop 的 stdio 定义不带 type：有 command 推断 stdio
        const [inferred] = McpConfigParser.parse({mcpServers: {gh: {command: "npx", args: ["-y", "github-mcp"]}}});
        assert.deepEqual(inferred?.config.transport, {type: "stdio"});
        assert.equal(inferred?.config.name, "gh");
        // 无 id / 无 url 的 http 条目跳过
        assert.equal(McpConfigParser.parse({mcpServers: {x: {type: "http"}}}).length, 0);
        assert.equal(McpConfigParser.parse({mcpServers: {"": {url: "https://x.example/mcp"}}}).length, 0);
    });
});
