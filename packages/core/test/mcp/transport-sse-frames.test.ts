import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ParseSseFrames } from "../../src/infra/mcp/logic/parse-sse-frames.js";

const responseFrame = (id: number): string => `data: {"jsonrpc":"2.0","id":${id},"result":{"tools":[]}}`;

describe("ParseSseFrames T-M14 多行 data / 注释行 / event 行 / CRLF", () => {
    it("同一帧内多行 data 按 SSE 规范以换行拼接成一条消息", () => {
        const outcome = ParseSseFrames.parse('data: {"jsonrpc":\ndata: "2.0","id":1,"result":{}}\n\n');
        assert.equal(outcome.invalid.length, 0);
        assert.equal(outcome.messages.length, 1);
        assert.equal((outcome.messages[0] as { id: number }).id, 1);
    });

    it("无空格形态 data: 前缀照常解析（真实网关案底）", () => {
        const outcome = ParseSseFrames.parse('data:{"jsonrpc":"2.0","id":2,"result":{}}\n\n');
        assert.equal(outcome.messages.length, 1);
        assert.equal((outcome.messages[0] as { id: number }).id, 2);
    });

    it(": 注释行既不产生消息也不破坏帧", () => {
        const outcome = ParseSseFrames.parse(`: keep-alive\n${responseFrame(1)}\n\n`);
        assert.equal(outcome.messages.length, 1);
        assert.equal((outcome.messages[0] as { id: number }).id, 1);
    });

    it("event: 行被忽略，data 照常投递", () => {
        const outcome = ParseSseFrames.parse(`event: message\n${responseFrame(3)}\n\n`);
        assert.equal(outcome.messages.length, 1);
        assert.equal((outcome.messages[0] as { id: number }).id, 3);
    });

    it("CRLF 换行与行尾残留不破坏解析", () => {
        const outcome = ParseSseFrames.parse(`data: {"jsonrpc":"2.0","id":4,"result":{}}\r\n\r\n`);
        assert.equal(outcome.messages.length, 1);
        assert.equal((outcome.messages[0] as { id: number }).id, 4);
    });

    it("一包多帧一次拆出", () => {
        const outcome = ParseSseFrames.parse(`${responseFrame(1)}\n\n${responseFrame(2)}\n\n`);
        assert.deepEqual(outcome.messages.map((message) => (message as { id: number }).id), [1, 2]);
    });

    it("末帧没有空行终结时宽容补派发", () => {
        const outcome = ParseSseFrames.parse(`${responseFrame(1)}\n\n${responseFrame(2)}\n`);
        assert.deepEqual(outcome.messages.map((message) => (message as { id: number }).id), [1, 2]);
    });

    it("纯注释与空文本产出空结果", () => {
        const outcome = ParseSseFrames.parse(": ping\n\n: pong\n\n");
        assert.equal(outcome.messages.length, 0);
        assert.equal(outcome.invalid.length, 0);
    });
});

describe("ParseSseFrames T-M15 非法帧只标记、不作废整条流", () => {
    it("合法帧照常投递，非法帧进 invalid 并带原文", () => {
        const outcome = ParseSseFrames.parse(`${responseFrame(1)}\n\ndata: {broken\n\n${responseFrame(2)}\n`);
        assert.deepEqual(outcome.messages.map((message) => (message as { id: number }).id), [1, 2]);
        assert.equal(outcome.invalid.length, 1);
        assert.equal(outcome.invalid[0]?.data, "{broken");
        assert.ok(outcome.invalid[0]?.error.length > 0);
    });

    it("合法 JSON 但非 JSON-RPC 形状也按非法帧标记", () => {
        const outcome = ParseSseFrames.parse('data: {"hello":"world"}\n\n');
        assert.equal(outcome.messages.length, 0);
        assert.equal(outcome.invalid.length, 1);
        assert.equal(outcome.invalid[0]?.data, '{"hello":"world"}');
    });

    it("JSON 语法坏帧标记后，同帧聚合的多行原文完整保留", () => {
        const outcome = ParseSseFrames.parse('data: {"a":\ndata: 1o}\n\n');
        assert.equal(outcome.messages.length, 0);
        assert.equal(outcome.invalid.length, 1);
        assert.equal(outcome.invalid[0]?.data, '{"a":\n1o}');
    });
});
