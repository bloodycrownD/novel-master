import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import {
  createOpenAiSseParserState,
  feedOpenAiSseChunk,
  finishOpenAiSse,
  parseOpenAiSseStream,
} from "../../../src/infra/llm-protocol/logic/openai-sse-parser.js";

describe("openai-sse-parser", () => {
  it("SSE-DATA-NS-01: `data:` 无空格形态不再被整流静默丢弃", () => {
    // 牙齿：把 parseSseDataLine 改回 `startsWith("data: ")` 形态，这条必红
    // （blocks 长度为 0，且 malformedLineCount 仍为 0 ⇒ 不抛错，症状是「秒回空消息」）。
    const state = createOpenAiSseParserState();
    const deltas: string[] = [];
    const onStream = (ev: { type: string; text?: string }) => {
      if (ev.type === "text-delta" && ev.text != null) {
        deltas.push(ev.text);
      }
    };

    feedOpenAiSseChunk(
      state,
      'data:{"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      onStream,
    );
    const { blocks } = finishOpenAiSse(state, onStream);
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as { text: string }).text, "Hi");
    assert.deepEqual(deltas, ["Hi"]);
    assert.equal(state.malformedLineCount, 0);
  });

  it("SSE-DATA-NS-02: 有空格形态不回归", () => {
    // 防「改成只认无空格」这种反向错修。
    const state = createOpenAiSseParserState();
    feedOpenAiSseChunk(
      state,
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
    );
    const { blocks } = finishOpenAiSse(state);
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as { text: string }).text, "Hi");
  });

  it("SSE-01: incremental text deltas", () => {
    const state = createOpenAiSseParserState();
    const deltas: string[] = [];

    feedOpenAiSseChunk(
      state,
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    );
    feedOpenAiSseChunk(
      state,
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    );

    const { blocks } = finishOpenAiSse(state);
    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "text");
    if (blocks[0]!.type === "text") {
      assert.equal(blocks[0].text, "Hello");
    }
  });

  it("SSE-02: chunk split mid-line across feeds", () => {
    const state = createOpenAiSseParserState();
    const deltas: string[] = [];
    const onStream = (ev: { type: string; text?: string }) => {
      if (ev.type === "text-delta" && ev.text != null) {
        deltas.push(ev.text);
      }
    };

    feedOpenAiSseChunk(state, 'data: {"choices":[{"delta":{"content":"A', onStream);
    feedOpenAiSseChunk(state, 'B"}}]}\n\n', onStream);

    const { blocks } = finishOpenAiSse(state, onStream);
    assert.deepEqual(deltas, ["AB"]);
    assert.equal((blocks[0] as { text: string }).text, "AB");
  });

  it("SSE-03: [DONE] and usage from final chunk", () => {
    const state = createOpenAiSseParserState();

    feedOpenAiSseChunk(
      state,
      [
        'data: {"choices":[{"delta":{"content":"Hi"}}]}',
        "",
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
    );

    const { streamRaw } = finishOpenAiSse(state);
    assert.ok(streamRaw != null && typeof streamRaw === "object");
    const usage = (streamRaw as { usage?: Record<string, number> }).usage;
    assert.equal(usage?.prompt_tokens, 5);
    assert.equal(usage?.completion_tokens, 1);
    assert.equal(usage?.total_tokens, 6);
  });

  it("SSE-04: tool delta accumulated by index", () => {
    const state = createOpenAiSseParserState();
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

    feedOpenAiSseChunk(state, `data: ${JSON.stringify(chunk1)}\n\n`, onStream);
    feedOpenAiSseChunk(state, `data: ${JSON.stringify(chunk2)}\n\n`, onStream);

    const { blocks } = finishOpenAiSse(state, onStream);

    assert.equal(toolUses.length, 1);
    assert.equal(toolUses[0]!.name, "read");
    assert.equal(toolUses[0]!.input.path, "/tmp/x");
    const toolBlock = blocks.find((b) => b.type === "tool_use");
    assert.ok(toolBlock && toolBlock.type === "tool_use");
    assert.equal(toolBlock.input.path, "/tmp/x");
  });

  it("parseOpenAiSseStream reads ReadableStream body", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Stream"}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sse.slice(0, 20)));
        controller.enqueue(encoder.encode(sse.slice(20)));
        controller.close();
      },
    });

    const deltas: string[] = [];
    const { blocks } = await parseOpenAiSseStream(body, (ev) => {
      if (ev.type === "text-delta") {
        deltas.push(ev.text);
      }
    });

    assert.deepEqual(deltas, ["Stream"]);
    assert.equal((blocks[0] as { text: string }).text, "Stream");
  });

  it("SSE-MAL-01: only malformed lines throw on finish", () => {
    const state = createOpenAiSseParserState();
    feedOpenAiSseChunk(state, "data: {not-json\n\n");
    assert.throws(
      () => finishOpenAiSse(state),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "MALFORMED_SSE");
        return true;
      },
    );
  });

  it("SSE-MAL-02: malformed plus valid text still yields blocks", () => {
    const state = createOpenAiSseParserState();
    feedOpenAiSseChunk(state, "data: bad\n\n");
    feedOpenAiSseChunk(
      state,
      "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n",
    );
    const { blocks } = finishOpenAiSse(state);
    assert.equal(state.malformedLineCount, 1);
    assert.equal(blocks.length, 1);
  });

  it("TU-01: tool-use after second arguments chunk before finish", () => {
    const state = createOpenAiSseParserState();
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
    feedOpenAiSseChunk(state, "data: " + chunk1 + "\n\n", onStream);
    assert.equal(toolUses.length, 0);
    feedOpenAiSseChunk(state, "data: " + chunk2 + "\n\n", onStream);
    assert.equal(toolUses.length, 1);
    finishOpenAiSse(state, onStream);
    assert.equal(toolUses.length, 1);
  });

  it("T-ITA-01 / TU-04: invalid tool JSON at finish degrades, no throw", () => {
    const state = createOpenAiSseParserState();
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
    feedOpenAiSseChunk(state, "data: " + bad + "\n\n");
    const { blocks, degradedToolCalls } = finishOpenAiSse(state);
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
    const state = createOpenAiSseParserState();
    const eventTypes: string[] = [];
    const onStream = (ev: { type: string }) => {
      eventTypes.push(ev.type);
    };

    feedOpenAiSseChunk(
      state,
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
      onStream,
    );
    finishOpenAiSse(state, onStream);

    assert.ok(
      !eventTypes.includes("usage"),
      "openai 协议层流中不应 emit usage 事件（含最后一块携带 usage 时）"
    );
    // 终值出口锁定：done 的 LlmChatResult.usage 来自 streamRaw.usage（既有行为）
    const { streamRaw } = finishOpenAiSse(state);
    const usage = (streamRaw as { usage?: Record<string, number> }).usage;
    assert.equal(usage?.completion_tokens, 2);
  });
});

