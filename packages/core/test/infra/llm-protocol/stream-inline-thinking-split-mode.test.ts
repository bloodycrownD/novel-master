import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  openAiStreamAccumulatorsToBlocks,
  openAiStreamDeltaToEvents,
} from "../../../src/infra/llm-protocol/logic/openai-content-mapper.js";
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

describe("openai stream text passthrough", () => {
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

  it("T-direct-tags: 流式内嵌标签均为 text-delta，finish 时标签留在 text", () => {
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

    const { blocks } = openAiStreamAccumulatorsToBlocks(state);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "text");
    if (blocks[0]!.type === "text") {
      assert.equal(blocks[0].text, "<thought>a</thought>b");
    }
  });

  it("T-direct-entities: 分 chunk 直通实体原文，finish 时实体留在 text", () => {
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

    const { blocks } = openAiStreamAccumulatorsToBlocks(state);
    assert.equal(blocks.length, 1);
    if (blocks[0]!.type === "text") {
      assert.equal(blocks[0].text, "&lt;thought&gt;a&lt;/thought&gt;b");
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

  it("T-structured-only: reasoning_content 进入 thinking，content 标签不挖空", () => {
    const state = createStreamState();
    openAiStreamDeltaToEvents(
      { content: "<thought>leak</thought>可见", reasoning_content: "structured" },
      state,
    );
    const { blocks } = openAiStreamAccumulatorsToBlocks(state);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.type, "thinking");
    assert.equal(blocks[1]!.type, "text");
    if (blocks[0]!.type === "thinking" && blocks[1]!.type === "text") {
      assert.equal(blocks[0].text, "structured");
      assert.equal(blocks[1].text, "<thought>leak</thought>可见");
    }
  });
});
