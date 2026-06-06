import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InlineThinkingStreamSplitter,
  cleanseReplyTextAndThinking,
  decodeBasicHtmlEntities,
  feedInlineThinkingAwareTextDelta,
  finishInlineThinkingAwareText,
  splitInlineThinkingFromText,
  stripLeakedThinkingFromText,
} from "../../../src/infra/llm-protocol/logic/inline-thinking-parser.js";

describe("inline-thinking-parser", () => {
  it("decodes HTML entities before tag matching", () => {
    const raw = "prefix&lt;thought&gt;secret&lt;/thought&gt;suffix";
    const split = splitInlineThinkingFromText(raw);
    assert.equal(split.thinking, "secret");
    assert.equal(split.visible, "prefixsuffix");
  });

  it("splits malformed >thought delimiter from visible reply", () => {
    const raw =
      "黎明前94>thought CRITICAL INSTRUCTION 1: use tools\n\n你好，这是面向用户的回复。";
    const split = splitInlineThinkingFromText(raw);
    assert.match(split.thinking, /CRITICAL INSTRUCTION/);
    assert.equal(split.visible, "你好，这是面向用户的回复。");
  });

  it("strips duplicate thinking already present in structured field", () => {
    const structured = "CRITICAL INSTRUCTION 1: use tools\n\nEnglish monologue";
    const text =
      "黎明前94>thought CRITICAL INSTRUCTION 1: use tools\n\nEnglish monologue\n\n你好。";
    const visible = stripLeakedThinkingFromText(text, structured);
    assert.equal(visible, "你好。");
  });

  it("cleanse merges structured and inline thinking without duplicating", () => {
    const result = cleanseReplyTextAndThinking(
      "<thought>inline only</thought>回复",
      "structured",
    );
    assert.equal(result.thinking, "structured\n\ninline only");
    assert.equal(result.visible, "回复");
  });

  it("stream splitter holds partial tag across chunks", () => {
    const splitter = new InlineThinkingStreamSplitter();
    const first = splitter.feed("hello <tho");
    assert.equal(first.text, "hello ");
    assert.equal(first.thinking, "");

    const second = splitter.feed("ught>secret</thought> world");
    assert.equal(second.text, " world");
    assert.equal(second.thinking, "secret");
  });

  it("stream state routes inline markers to thinkingParts", () => {
    const state = { textParts: [] as string[], thinkingParts: [] as string[] };
    const deltas: Array<{ type: string; text: string }> = [];
    const onStream = (ev: { type: string; text: string }) => {
      deltas.push(ev);
    };

    feedInlineThinkingAwareTextDelta(
      state,
      ">thought internal\n\n",
      onStream,
    );
    feedInlineThinkingAwareTextDelta(state, "visible", onStream);
    finishInlineThinkingAwareText(state, onStream);

    assert.equal(state.thinkingParts.join(""), "internal\n\n");
    assert.equal(state.textParts.join(""), "visible");
    assert.ok(deltas.some((d) => d.type === "thinking-delta"));
  });

  it("decodeBasicHtmlEntities round-trips common escapes", () => {
    assert.equal(decodeBasicHtmlEntities("&gt;thought"), ">thought");
  });
});
