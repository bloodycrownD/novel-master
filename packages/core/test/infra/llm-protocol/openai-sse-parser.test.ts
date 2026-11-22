import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  AppErrorOps  } from "../../../src/errors/app-error.js";
import {  OpenAiSseParser  } from "../../../src/infra/llm-protocol/logic/openai-sse-parser.js";

describe("openai-sse-parser", () => {
    it("SSE-DATA-NS-01: `data:` 无空格形态不再被整流静默丢弃", () => {
        // 牙齿：把 parseSseDataLine 改回 `startsWith("data: ")` 形态，这条必红
        // （blocks 长度为 0，且 malformedLineCount 仍为 0 ⇒ 不抛错，症状是「秒回空消息」）。
        const deltas: string[] = [];
        const onStream = (ev: { type: string; text?: string }) => {
            if (ev.type === "text-delta" && ev.text != null) {
                deltas.push(ev.text);
            }
        };
        const parser = OpenAiSseParser.create({ onStream });

        parser.feed('data:{"choices":[{"delta":{"content":"Hi"}}]}\n\n');
        const { blocks } = parser.finish();
        assert.equal(blocks.length, 1);
        assert.equal((blocks[0] as { text: string }).text, "Hi");
        assert.deepEqual(deltas, ["Hi"]);
        assert.equal(parser.state.malformedLineCount, 0);
    });

    it("SSE-DATA-NS-02: 有空格形态不回归", () => {
        // 防「改成只认无空格」这种反向错修。
        const parser = OpenAiSseParser.create();
        parser.feed('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n');
        const { blocks } = parser.finish();
        assert.equal(blocks.length, 1);
        assert.equal((blocks[0] as { text: string }).text, "Hi");
    });

    it("SSE-01: incremental text deltas", () => {
        const deltas: string[] = [];
        const parser = OpenAiSseParser.create({
            onStream: (ev) => {
                if (ev.type === "text-delta") {
                    deltas.push(ev.text);
                }
            },
        });

        parser.feed('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
        parser.feed('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');

        const { blocks } = parser.finish();
        assert.deepEqual(deltas, ["Hel", "lo"]);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0]!.type, "text");
        if (blocks[0]!.type === "text") {
            assert.equal(blocks[0].text, "Hello");
        }
    });

    it("SSE-02: chunk split mid-line across feeds", () => {
        const deltas: string[] = [];
        const onStream = (ev: { type: string; text?: string }) => {
            if (ev.type === "text-delta" && ev.text != null) {
                deltas.push(ev.text);
            }
        };
        const parser = OpenAiSseParser.create({ onStream });

        parser.feed('data: {"choices":[{"delta":{"content":"A');
        parser.feed('B"}}]}\n\n');

        const { blocks } = parser.finish();
        assert.deepEqual(deltas, ["AB"]);
        assert.equal((blocks[0] as { text: string }).text, "AB");
    });

    it("SSE-03: [DONE] and usage from final chunk", () => {
        const parser = OpenAiSseParser.create();

        parser.feed(
            [
                'data: {"choices":[{"delta":{"content":"Hi"}}]}',
                "",
                'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}',
                "",
                "data: [DONE]",
                "",
            ].join("\n"),
        );

        const { streamRaw } = parser.finish();
        assert.ok(streamRaw != null && typeof streamRaw === "object");
        const usage = (streamRaw as { usage?: Record<string, number> }).usage;
        assert.equal(usage?.prompt_tokens, 5);
        assert.equal(usage?.completion_tokens, 1);
        assert.equal(usage?.total_tokens, 6);
    });

    it("SSE-04: tool delta accumulated by index", () => {
        const toolUses: Array<{ name: string; input: Record<string, unknown> }> = [];

        const chunk1 = {
            choices: [
                {
                    delta: {
                        tool_calls: [
                            {
                                index: 0,
                                id: "call_1",
                                function: { name: "read", arguments: '{"path":' },
                            },
                        ],
                    },
                },
            ],
        };
        const chunk2 = {
            choices: [
                {
                    delta: {
                        tool_calls: [{ index: 0, function: { arguments: '"/tmp/x"}' } }],
                    },
                },
            ],
        };

        const onStream = (ev: { type: string; name?: string; input?: Record<string, unknown> }) => {
            if (ev.type === "tool-use") {
                toolUses.push({ name: ev.name!, input: ev.input! });
            }
        };
        const parser = OpenAiSseParser.create({ onStream });

        parser.feed(`data: ${JSON.stringify(chunk1)}\n\n`);
        parser.feed(`data: ${JSON.stringify(chunk2)}\n\n`);

        const { blocks } = parser.finish();

        assert.equal(toolUses.length, 1);
        assert.equal(toolUses[0]!.name, "read");
        assert.equal(toolUses[0]!.input.path, "/tmp/x");
        const toolBlock = blocks.find((b) => b.type === "tool_use");
        assert.ok(toolBlock && toolBlock.type === "tool_use");
        assert.equal(toolBlock.input.path, "/tmp/x");
    });

    it("SSE-MAL-01: only malformed lines throw on finish", () => {
        const parser = OpenAiSseParser.create();
        parser.feed("data: {not-json\n\n");
        assert.throws(
            () => parser.finish(),
            (err: unknown) => {
                assert.ok(AppErrorOps.is(err, "PROVIDER_MALFORMED_SSE"));
                return true;
            },
        );
    });

    it("SSE-MAL-02: malformed plus valid text still yields blocks", () => {
        const parser = OpenAiSseParser.create();
        parser.feed("data: bad\n\n");
        parser.feed("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n");
        const { blocks } = parser.finish();
        assert.equal(parser.state.malformedLineCount, 1);
        assert.equal(blocks.length, 1);
    });

    it("TU-01: tool-use after second arguments chunk before finish", () => {
        const toolUses: unknown[] = [];
        const onStream = (ev: { type: string }) => {
            if (ev.type === "tool-use") toolUses.push(ev);
        };
        const chunk1 = JSON.stringify({
            choices: [
                {
                    delta: {
                        tool_calls: [
                            {
                                index: 0,
                                id: "call_1",
                                function: { name: "read", arguments: "{\"path\":" },
                            },
                        ],
                    },
                },
            ],
        });
        const chunk2 = JSON.stringify({
            choices: [
                {
                    delta: {
                        tool_calls: [{ index: 0, function: { arguments: "\"/z\"}" } }],
                    },
                },
            ],
        });
        const parser = OpenAiSseParser.create({ onStream });
        parser.feed("data: " + chunk1 + "\n\n");
        assert.equal(toolUses.length, 0);
        parser.feed("data: " + chunk2 + "\n\n");
        assert.equal(toolUses.length, 1);
        parser.finish();
        assert.equal(toolUses.length, 1);
    });

    it("T-ITA-01 / TU-04: invalid tool JSON at finish degrades, no throw", () => {
        const parser = OpenAiSseParser.create();
        const bad = JSON.stringify({
            choices: [
                {
                    delta: {
                        tool_calls: [
                            {
                                index: 0,
                                id: "c1",
                                function: { name: "read", arguments: "{bad" },
                            },
                        ],
                    },
                },
            ],
        });
        parser.feed("data: " + bad + "\n\n");
        const { blocks, degradedToolCalls } = parser.finish();
        assert.equal(degradedToolCalls.length, 1);
        assert.equal(degradedToolCalls[0]!.id, "c1");
        assert.equal(degradedToolCalls[0]!.name, "read");
        assert.equal(degradedToolCalls[0]!.reason, "INVALID_TOOL_ARGUMENTS");
        assert.equal(degradedToolCalls[0]!.rawArguments, "{bad");
        const toolUse = blocks.find((b) => b.type === "tool_use");
        assert.ok(toolUse && toolUse.type === "tool_use");
        assert.deepEqual(toolUse.input, {});
    });

    it("T-M3: 协议层流中零 usage 事件；usage 终值只在 streamRaw（done 结果由 runner 补发）", () => {
        const eventTypes: string[] = [];
        const onStream = (ev: { type: string }) => {
            eventTypes.push(ev.type);
        };
        const parser = OpenAiSseParser.create({ onStream });

        parser.feed(
            [
                'data: {"choices":[{"delta":{"content":"Hel"}}]}',
                "",
                'data: {"choices":[{"delta":{"content":"lo"}}]}',
                "",
                // 协议限制：usage 只随最后一块到达（常为空 choices）——流中不 emit
                'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
                "",
                "data: [DONE]",
                "",
            ].join("\n"),
        );
        parser.finish();

        assert.ok(
            !eventTypes.includes("usage"),
            "openai 协议层流中不应 emit usage 事件（含最后一块携带 usage 时）"
        );
        // 终值出口锁定：done 的 LlmChatResult.usage 来自 streamRaw.usage（既有行为）
        const { streamRaw } = parser.finish();
        const usage = (streamRaw as { usage?: Record<string, number> }).usage;
        assert.equal(usage?.completion_tokens, 2);
    });
});
