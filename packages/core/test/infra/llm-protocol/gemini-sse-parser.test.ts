import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import {
  createGeminiSseParserState,
  feedGeminiSseChunk,
  finishGeminiSse,
  finishGeminiSsePartial,
} from "../../../src/infra/llm-protocol/logic/gemini-sse-parser.js";

describe("gemini-sse-parser", () => {
  it("T6: parses incremental text SSE and done", () => {
    const state = createGeminiSseParserState();
    const deltas: string[] = [];

    feedGeminiSseChunk(
      state,
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"}}]}',
        "",
      ].join("\n"),
      (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    );

    const { blocks } = finishGeminiSse(state);
    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.equal(blocks.length, 1);
    if (blocks[0]?.type === "text") {
      assert.equal(blocks[0].text, "Hello");
    }
  });

  it("T7b: 内嵌 >thought 泄漏留在 text，结构化 thought 仍进 thinking", () => {
    const state = createGeminiSseParserState();
    const streamEvents: Array<{ type: string; text?: string }> = [];
    const onStream = (ev: { type: string; text?: string }) => {
      streamEvents.push(ev);
    };

    feedGeminiSseChunk(
      state,
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"plan","thought":true}]}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"黎明前94>thought plan\\n\\n"}]}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"你好。"}]}}]}',
        "",
      ].join("\n"),
      onStream,
    );

    const leakDelta = streamEvents.find(
      (ev) =>
        ev.type === "text-delta" &&
        ev.text != null &&
        ev.text.includes(">thought"),
    );
    assert.ok(leakDelta, "含 >thought 的 chunk 应以 text-delta 原文流出");

    const { blocks } = finishGeminiSse(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "thinking");
    assert.equal(blocks[1]?.type, "text");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].text, "plan");
    }
    if (blocks[1]?.type === "text") {
      // 不再从 content 挖标签：泄漏段与可见回复均留在 text
      assert.equal(blocks[1].text, "黎明前94>thought plan\n\n你好。");
    }
  });

  it("extracts thought_signature from streamed thinking parts", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"text":"plan","thought":true,"thought_signature":"sig-stream"}]}}]}\n',
    );
    const { blocks } = finishGeminiSse(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].thinkingSignature, "sig-stream");
    }
  });

  it("functionCall thought_signature stays on tool_use, not empty thinking block", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"/a"},"id":"call_1"},"thought_signature":"sig-fc-only"}]}}]}\n',
    );
    const { blocks } = finishGeminiSse(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_use");
    if (blocks[0]?.type === "tool_use") {
      assert.equal(blocks[0].name, "read");
      assert.equal(blocks[0].thinkingSignature, "sig-fc-only");
    }
  });

  it("functionCall 参数增长时累积 args 并在 finish 时 emit tool-use", () => {
    const state = createGeminiSseParserState();
    const toolUses: unknown[] = [];
    const onStream = (ev: { type: string; name?: string }) => {
      if (ev.type === "tool-use") {
        toolUses.push(ev);
      }
    };

    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"write","args":{"path":"/a"},"id":"c1"}}]}}]}\n',
      onStream,
    );
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"write","args":{"path":"/a","content":"hello"},"id":"c1"}}]}}]}\n',
      onStream,
    );

    finishGeminiSse(state, onStream);
    assert.equal(toolUses.length, 1);
  });

  it("T7: abort partial keeps thinking without empty text", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      'data: {"candidates":[{"content":{"parts":[{"text":"thought","thought":true}]}}]}\n',
    );
    const { blocks } = finishGeminiSsePartial(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
  });
  it("SSE-MAL-01: only malformed lines throw on finish", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(state, "data: {not-json\n\n");
    assert.throws(
      () => finishGeminiSse(state),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, "MALFORMED_SSE");
        return true;
      },
    );
  });

  it("SSE-MAL-02: malformed line with valid text", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(state, "data: oops\n\n");
    feedGeminiSseChunk(
      state,
      "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"x\"}]}}]}\n\n",
    );
    const { blocks } = finishGeminiSse(state);
    assert.equal(state.malformedLineCount, 1);
    assert.equal(blocks.length, 1);
  });

  it("TU-02: midway tool-use when functionCall args complete", () => {
    const state = createGeminiSseParserState();
    const toolUses: unknown[] = [];
    const onStream = (ev: { type: string }) => {
      if (ev.type === "tool-use") toolUses.push(ev);
    };
    feedGeminiSseChunk(
      state,
      "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"write\",\"args\":{\"path\":\"/a\"},\"id\":\"c1\"}}]}}]}\n",
      onStream,
    );
    assert.equal(toolUses.length, 1);
    feedGeminiSseChunk(
      state,
      "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"write\",\"args\":{\"path\":\"/a\",\"content\":\"hi\"},\"id\":\"c1\"}}]}}]}\n",
      onStream,
    );
    assert.equal(toolUses.length, 1);
    finishGeminiSse(state, onStream);
    assert.equal(toolUses.length, 1);
  });

  it("T-ITA-02 / TU-04: invalid args JSON at finish degrades, no throw", () => {
    const state = createGeminiSseParserState();
    state.functionCalls.set("c1", {
      name: "read",
      argsJson: "{bad",
      id: "c1",
    });
    const { blocks, degradedToolCalls } = finishGeminiSse(state);
    assert.equal(degradedToolCalls.length, 1);
    assert.equal(degradedToolCalls[0]!.id, "c1");
    assert.equal(degradedToolCalls[0]!.reason, "INVALID_TOOL_ARGUMENTS");
    const toolUse = blocks.find((b) => b.type === "tool_use");
    assert.ok(toolUse && toolUse.type === "tool_use");
    assert.deepEqual(toolUse.input, {});
  });

});
