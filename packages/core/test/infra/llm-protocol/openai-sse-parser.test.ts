import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOpenAiSseParserState,
  feedOpenAiSseChunk,
  finishOpenAiSse,
  parseOpenAiSseStream,
} from "../../../src/infra/llm-protocol/logic/openai-sse-parser.js";

describe("openai-sse-parser", () => {
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

    feedOpenAiSseChunk(state, `data: ${JSON.stringify(chunk1)}\n\n`, (ev) => {
      if (ev.type === "tool-use") {
        toolUses.push({ name: ev.name, input: ev.input });
      }
    });
    feedOpenAiSseChunk(state, `data: ${JSON.stringify(chunk2)}\n\n`);

    const { blocks } = finishOpenAiSse(state, (ev) => {
      if (ev.type === "tool-use") {
        toolUses.push({ name: ev.name, input: ev.input });
      }
    });

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
});
