import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McpConfigParser } from "../../src/domain/mcp/logic/parse-mcp-server-config.js";
import { MCP_DEFAULT_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS, McpServerConfigOps } from "../../src/domain/mcp/model/mcp-server-config.js";
import { McpFailureOps } from "../../src/domain/mcp/model/mcp-failure.js";

describe("parse-mcp-server-config", () => {
    it("T-M1: 六种 type 写法归一（http / streamableHttp / streamable-http / streamable_http / stdio / sse）", () => {
        const configs = McpConfigParser.parse([
            {id: "a", type: "http", url: "https://a.example/mcp"},
            {id: "b", type: "streamableHttp", url: "https://b.example/mcp"},
            {id: "c", type: "streamable-http", url: "https://c.example/mcp"},
            {id: "d", type: "streamable_http", url: "https://d.example/mcp"},
            {id: "e", type: "stdio", command: "npx"},
            {id: "f", type: "sse", url: "https://f.example/sse"},
        ]);
        assert.equal(configs.length, 6);
        const byId = new Map(configs.map((config) => [config.id, config]));
        for (const id of ["a", "b", "c", "d"]) assert.equal(byId.get(id)?.transport.type, "http", `id=${id}`);
        assert.equal(byId.get("e")?.transport.type, "stdio");
        assert.equal(byId.get("f")?.transport.type, "sse");
        // 大小写不敏感
        const [mixed] = McpConfigParser.parse([{id: "m", type: "StreamableHTTP", url: "https://m.example/mcp"}]);
        assert.equal(mixed?.transport.type, "http");
    });

    it("T-M4: 缺 timeoutMs 补默认 120000；0 / 负数钳到 1000；未知字段丢弃；损坏 JSON 回缺省", () => {
        const [missing] = McpConfigParser.parse([{id: "a", url: "https://a.example/mcp"}]);
        assert.equal(missing?.timeoutMs, MCP_DEFAULT_TIMEOUT_MS);
        const [zero] = McpConfigParser.parse([{id: "z", type: "http", url: "https://z.example/mcp", timeoutMs: 0}]);
        assert.equal(zero?.timeoutMs, MCP_MIN_TIMEOUT_MS);
        const [negative] = McpConfigParser.parse([{id: "n", transport: {type: "http", url: "https://n.example/mcp"}, timeoutMs: -5}]);
        assert.equal(negative?.timeoutMs, MCP_MIN_TIMEOUT_MS);
        const [extra] = McpConfigParser.parse([{id: "e", type: "http", url: "https://e.example/mcp", vendorSpecific: "junk", nested: {deep: true}}]);
        assert.deepEqual(Object.keys(extra ?? {}).sort(), ["auth", "description", "enabled", "id", "timeoutMs", "transport"]);
        assert.deepEqual(Object.keys(extra?.transport ?? {}), ["type", "url"]);
        // 损坏 JSON / 形状不认识 → 缺省（空列表）
        assert.deepEqual(McpConfigParser.parse("{broken json"), []);
        assert.deepEqual(McpConfigParser.parse("not json at all"), []);
        assert.deepEqual(McpConfigParser.parse(42), []);
        // 存储字符串（KKV 读出形态）可解析
        const [fromString] = McpConfigParser.parse(JSON.stringify([{id: "s", transport: {type: "http", url: "https://s.example/mcp"}}]));
        assert.equal(fromString?.transport.type, "http");
    });

    it("T-M11a(解析半): stdio 只归一收 {type:\"stdio\"}，command / args / env / cwd 丢弃，解析算成功", () => {
        const configs = McpConfigParser.parse([{id: "fs", command: "npx", args: ["-y", "fs-mcp"], env: {TOKEN: "x"}, cwd: "/tmp"}]);
        assert.equal(configs.length, 1);
        const config = configs[0]!;
        assert.deepEqual(config.transport, {type: "stdio"});
        const serialized = JSON.stringify(config);
        for (const leaked of ["npx", "fs-mcp", "TOKEN", "/tmp"]) assert.equal(serialized.includes(leaked), false, `不应残留 stdio 细节：${leaked}`);
    });

    it("T-M11a/T-M11b(纯函数半): stdio+http 混合按 isTransportSupported 过滤只剩 http，stdio 失败形态可读出", () => {
        const configs = McpConfigParser.parse([{id: "local", command: "npx"}, {id: "remote", url: "https://remote.example/mcp"}]);
        const usable = configs.filter(McpServerConfigOps.isTransportSupported);
        assert.deepEqual(usable.map((config) => config.id), ["remote"]);
        const stdio = configs.find((config) => config.id === "local")!;
        const failure = McpFailureOps.unsupportedTransport(stdio.transport.type);
        assert.equal(failure.kind, "server");
        assert.equal(failure.action, "fix-config");
        assert.ok(failure.detail.includes("暂不支持 stdio"));
    });

    it("description 取条目 description（字符串原样、缺省 / 非字符串回空串），不再从名称推导", () => {
        const [described] = McpConfigParser.parse([{id: "d", description: "知识库", transport: {type: "http", url: "https://d.example/mcp"}}]);
        assert.equal(described?.description, "知识库");
        const [blank] = McpConfigParser.parse([{id: "b", transport: {type: "http", url: "https://b.example/mcp"}}]);
        assert.equal(blank?.description, "");
        const [junk] = McpConfigParser.parse([{id: "j", description: 42, transport: {type: "http", url: "https://j.example/mcp"}}]);
        assert.equal(junk?.description, "");
    });

    it("存储形态往返：enabled / description / auth 原样保留，缺省补齐", () => {
        const [disabled] = McpConfigParser.parse([{id: "off", description: "关着的", enabled: false, transport: {type: "http", url: "https://off.example/mcp"}}]);
        assert.equal(disabled?.enabled, false);
        assert.equal(disabled?.description, "关着的");
        assert.deepEqual(disabled?.auth, {type: "none"});
        const [storedBearer] = McpConfigParser.parse([{id: "s", transport: {type: "http", url: "https://s.example/mcp"}, auth: {type: "bearer", secretRef: "mcp/s/bearer"}}]);
        assert.deepEqual(storedBearer?.auth, {type: "bearer", secretRef: "mcp/s/bearer"});
        const [storedOAuth] = McpConfigParser.parse([{id: "o", transport: {type: "http", url: "https://o.example/mcp"}, auth: {type: "oauth"}}]);
        assert.deepEqual(storedOAuth?.auth, {type: "oauth"});
        // Claude Desktop 的 stdio 定义不带 type：有 command 推断 stdio
        const [inferred] = McpConfigParser.parse([{id: "gh", command: "npx", args: ["-y", "github-mcp"]}]);
        assert.deepEqual(inferred?.transport, {type: "stdio"});
        // 无 id / 无 url 的 http 条目跳过
        assert.equal(McpConfigParser.parse([{id: "", type: "http", url: "https://x.example/mcp"}]).length, 0);
        assert.equal(McpConfigParser.parse([{type: "http", url: "https://x.example/mcp"}]).length, 0);
        assert.equal(McpConfigParser.parse([{id: "x", type: "http"}]).length, 0);
    });
});

describe("McpServerConfigOps.isValidId", () => {
    it("合法：英文字母 / 数字，单个下划线分隔", () => {
        for (const id of ["a", "Z", "notes_db", "Acme2_kb", "a1_b2_C3"]) {
            assert.equal(McpServerConfigOps.isValidId(id), true, `id=${id}`);
        }
    });

    it("非法：空串 / 连字符 / 空格 / 中文 / 点 / 其它符号", () => {
        for (const id of ["", "a-b", "a b", "知识库", "a.b", "mcp:abc", "a/b", "a+b"]) {
            assert.equal(McpServerConfigOps.isValidId(id), false, `id=${id}`);
        }
    });

    it("非法：连续下划线或首尾下划线（`__` 是工具名里 ID 与工具名的分隔符，ID 里不能出现）", () => {
        for (const id of ["_", "a__b", "_a", "a_", "__"]) {
            assert.equal(McpServerConfigOps.isValidId(id), false, `id=${id}`);
        }
    });
});
