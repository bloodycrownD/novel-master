import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  feedInlineThinkingAwareTextDelta,
  finishInlineThinkingAwareText,
} from "../../../src/infra/llm-protocol/logic/inline-thinking-parser.js";
import {
  openAiStreamAccumulatorsToBlocks,
  openAiStreamDeltaToEvents,
} from "../../../src/infra/llm-protocol/logic/openai-content-mapper.js";
import {
  inlineStreamThinkingSplitEnabled,
  setInlineStreamThinkingSplitForTests,
} from "../../../src/infra/llm-protocol/logic/stream-inline-thinking-split-mode.js";
import type { LlmStreamEvent } from "../../../src/infra/llm-protocol/ports/adapter.port.js";

function createStreamState() {
  return {
    textParts: [] as string[],
    thinkingParts: [] as string[],
    toolCalls: new Map(),
    emittedToolIndices: new Set<number>(),
  };
}

function collectEvents(
  fn: (onStream: (ev: LlmStreamEvent) => void) => void,
): LlmStreamEvent[] {
  const events: LlmStreamEvent[] = [];
  fn((ev) => events.push(ev));
  return events;
}

describe("stream-inline-thinking-split-mode", () => {
  afterEach(() => {
    setInlineStreamThinkingSplitForTests(undefined);
  });

  it("默认关闭 legacy splitter（直通 delta）", () => {
    assert.equal(inlineStreamThinkingSplitEnabled(), false);
  });

  it("T-direct-default: content Hello 发出一条 text-delta", () => {
    const state = createStreamState();
    const events = collectEvents((onStream) => {
      openAiStreamDeltaToEvents({ content: "Hello" }, state, onStream);
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "text-delta");
    if (events[0]!.type === "text-delta") {
      assert.equal(events[0].text, "Hello");
    }
  });

  it("T-direct-tags: 流式内嵌标签均为 text-delta，finish 时 cleanse 分离", () => {
    const state = createStreamState();
    const chunks = ["<thought>", "a", "</thought>", "b"];
    const events: LlmStreamEvent[] = [];

    for (const chunk of chunks) {
      openAiStreamDeltaToEvents({ content: chunk }, state, (ev) => events.push(ev));
    }

    assert.ok(events.every((ev) => ev.type === "text-delta"));
    assert.equal(
      events
        .filter((ev) => ev.type === "text-delta")
        .map((ev) => (ev.type === "text-delta" ? ev.text : ""))
        .join(""),
      "<thought>a</thought>b",
    );

    const blocks = openAiStreamAccumulatorsToBlocks(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "thinking");
    assert.equal(blocks[1]!.type, "text");
    if (blocks[0]!.type === "thinking" && blocks[1]!.type === "text") {
      assert.equal(blocks[0].text, "a");
      assert.equal(blocks[1].text, "b");
    }
  });

  it("T-direct-entities: 分 chunk 直通实体原文，finish 解码并分离", () => {
    const state = createStreamState();
    const chunks = ["&lt;thought&gt;", "a", "&lt;/thought&gt;", "b"];
    const events: LlmStreamEvent[] = [];

    for (const chunk of chunks) {
      openAiStreamDeltaToEvents({ content: chunk }, state, (ev) => events.push(ev));
    }

    assert.ok(events.every((ev) => ev.type === "text-delta"));
    assert.equal(
      events
        .filter((ev) => ev.type === "text-delta")
        .map((ev) => (ev.type === "text-delta" ? ev.text : ""))
        .join(""),
      "&lt;thought&gt;a&lt;/thought&gt;b",
    );

    const blocks = openAiStreamAccumulatorsToBlocks(state);
    assert.equal(blocks.length, 2);
    if (blocks[0]!.type === "thinking" && blocks[1]!.type === "text") {
      assert.equal(blocks[0].text, "a");
      assert.equal(blocks[1].text, "b");
    }
  });

  it("T-dual-field: 同 chunk content 先于 reasoning_content", () => {
    const state = createStreamState();
    const events = collectEvents((onStream) => {
      openAiStreamDeltaToEvents(
        { content: "B", reasoning_content: "R" },
        state,
        onStream,
      );
    });
    assert.deepEqual(
      events.map((ev) => ({ type: ev.type, text: "text" in ev ? ev.text : undefined })),
      [
        { type: "text-delta", text: "B" },
        { type: "thinking-delta", text: "R" },
      ],
    );
  });

  it("T-legacy-split: 启用 splitter 时与 inline-thinking-parser 行为一致", () => {
    setInlineStreamThinkingSplitForTests(true);
    assert.equal(inlineStreamThinkingSplitEnabled(), true);

    const legacyState = { textParts: [] as string[], thinkingParts: [] as string[] };
    const legacyDeltas: Array<{ type: string; text: string }> = [];
    const onLegacy = (ev: { type: string; text: string }) => {
      legacyDeltas.push(ev);
    };
    feedInlineThinkingAwareTextDelta(legacyState, ">thought internal\n\n", onLegacy);
    feedInlineThinkingAwareTextDelta(legacyState, "visible", onLegacy);
    finishInlineThinkingAwareText(legacyState, onLegacy);

    const streamState = createStreamState();
    const streamDeltas: Array<{ type: string; text: string }> = [];
    const onStream = (ev: LlmStreamEvent) => {
      if (ev.type === "text-delta" || ev.type === "thinking-delta") {
        streamDeltas.push(ev);
      }
    };
    openAiStreamDeltaToEvents(
      { content: ">thought internal\n\n" },
      streamState,
      onStream,
    );
    openAiStreamDeltaToEvents({ content: "visible" }, streamState, onStream);
    openAiStreamAccumulatorsToBlocks(streamState, onStream);

    assert.equal(streamState.thinkingParts.join(""), legacyState.thinkingParts.join(""));
    assert.equal(streamState.textParts.join(""), legacyState.textParts.join(""));
    assert.ok(streamDeltas.some((d) => d.type === "thinking-delta"));
  });
});
