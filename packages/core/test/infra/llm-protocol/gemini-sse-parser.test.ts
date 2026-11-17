import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "../../../src/errors/app-error.js";
import { createGeminiSseParser } from "../../../src/infra/llm-protocol/logic/gemini-sse-parser.js";

describe("gemini-sse-parser", () => {
  it("SSE-DATA-NS-01: `data:` 无空格形态不再被整流静默丢弃", () => {
    // 牙齿：把 parseSseDataLine 改回 `startsWith("data: ")` 形态，这条必红
    // （blocks 长度为 0，且 malformedLineCount 仍为 0 ⇒ 不抛错）。
    const deltas: string[] = [];
    const onStream = (ev: { type: string; text?: string }) => {
      if (ev.type === "text-delta" && ev.text != null) {
        deltas.push(ev.text);
      }
    };
    const parser = createGeminiSseParser({ onStream });

    parser.feed('data:{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n');
    const { blocks } = parser.finish();
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as { text: string }).text, "Hi");
    assert.deepEqual(deltas, ["Hi"]);
    assert.equal(parser.state.malformedLineCount, 0);
  });

  it("SSE-DATA-NS-02: 有空格形态不回归", () => {
    const parser = createGeminiSseParser();
    parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n');
    const { blocks } = parser.finish();
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as { text: string }).text, "Hi");
  });

  it("T6: parses incremental text SSE and done", () => {
    const deltas: string[] = [];
    const parser = createGeminiSseParser({
      onStream: (ev) => {
        if (ev.type === "text-delta") {
          deltas.push(ev.text);
        }
      },
    });

    parser.feed(
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"}}]}',
        "",
      ].join("\n"),
    );

    const { blocks } = parser.finish();
    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.equal(blocks.length, 1);
    if (blocks[0]?.type === "text") {
      assert.equal(blocks[0].text, "Hello");
    }
  });

  it("T7b: 内嵌 >thought 泄漏留在 text，结构化 thought 仍进 thinking", () => {
    const streamEvents: Array<{ type: string; text?: string }> = [];
    const onStream = (ev: { type: string; text?: string }) => {
      streamEvents.push(ev);
    };
    const parser = createGeminiSseParser({ onStream });

    parser.feed(
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"plan","thought":true}]}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"黎明前94>thought plan\\n\\n"}]}}]}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"你好。"}]}}]}',
        "",
      ].join("\n"),
    );

    const leakDelta = streamEvents.find(
      (ev) =>
        ev.type === "text-delta" &&
        ev.text != null &&
        ev.text.includes(">thought"),
    );
    assert.ok(leakDelta, "含 >thought 的 chunk 应以 text-delta 原文流出");

    const { blocks } = parser.finish();
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
    const parser = createGeminiSseParser();
    parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"plan","thought":true,"thought_signature":"sig-stream"}]}}]}\n');
    const { blocks } = parser.finish();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
    if (blocks[0]?.type === "thinking") {
      assert.equal(blocks[0].thinkingSignature, "sig-stream");
    }
  });

  it("functionCall thought_signature stays on tool_use, not empty thinking block", () => {
    const parser = createGeminiSseParser();
    parser.feed('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"/a"},"id":"call_1"},"thought_signature":"sig-fc-only"}]}}]}\n');
    const { blocks } = parser.finish();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_use");
    if (blocks[0]?.type === "tool_use") {
      assert.equal(blocks[0].name, "read");
      assert.equal(blocks[0].thinkingSignature, "sig-fc-only");
    }
  });

  it("functionCall 参数增长时累积 args 并在 finish 时 emit tool-use", () => {
    const toolUses: unknown[] = [];
    const onStream = (ev: { type: string; name?: string }) => {
      if (ev.type === "tool-use") {
        toolUses.push(ev);
      }
    };
    const parser = createGeminiSseParser({ onStream });

    parser.feed('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"write","args":{"path":"/a"},"id":"c1"}}]}}]}\n');
    parser.feed('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"write","args":{"path":"/a","content":"hello"},"id":"c1"}}]}}]}\n');

    parser.finish();
    assert.equal(toolUses.length, 1);
  });

  it("T7: abort partial keeps thinking without empty text", () => {
    const parser = createGeminiSseParser();
    parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"thought","thought":true}]}}]}\n');
    const { blocks } = parser.finishPartial();
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "thinking");
  });
  it("SSE-MAL-01: only malformed lines throw on finish", () => {
    const parser = createGeminiSseParser();
    parser.feed("data: {not-json\n\n");
    assert.throws(
      () => parser.finish(),
      (err: unknown) => {
        assert.ok(isAppError(err, "PROVIDER_MALFORMED_SSE"));
        return true;
      },
    );
  });

  it("SSE-MAL-02: malformed line with valid text", () => {
    const parser = createGeminiSseParser();
    parser.feed("data: oops\n\n");
    parser.feed("data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"x\"}]}}]}\n\n");
    const { blocks } = parser.finish();
    assert.equal(parser.state.malformedLineCount, 1);
    assert.equal(blocks.length, 1);
  });

  it("TU-02: midway tool-use when functionCall args complete", () => {
    const toolUses: unknown[] = [];
    const onStream = (ev: { type: string }) => {
      if (ev.type === "tool-use") toolUses.push(ev);
    };
    const parser = createGeminiSseParser({ onStream });
    parser.feed("data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"write\",\"args\":{\"path\":\"/a\"},\"id\":\"c1\"}}]}}]}\n");
    assert.equal(toolUses.length, 1);
    parser.feed("data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"write\",\"args\":{\"path\":\"/a\",\"content\":\"hi\"},\"id\":\"c1\"}}]}}]}\n");
    assert.equal(toolUses.length, 1);
    parser.finish();
    assert.equal(toolUses.length, 1);
  });

  it("T-ITA-02 / TU-04: invalid args JSON at finish degrades, no throw", () => {
    const parser = createGeminiSseParser();
    parser.state.functionCalls.set("c1", {
      name: "read",
      argsJson: "{bad",
      id: "c1",
    });
    const { blocks, degradedToolCalls } = parser.finish();
    assert.equal(degradedToolCalls.length, 1);
    assert.equal(degradedToolCalls[0]!.id, "c1");
    assert.equal(degradedToolCalls[0]!.reason, "INVALID_TOOL_ARGUMENTS");
    const toolUse = blocks.find((b) => b.type === "tool_use");
    assert.ok(toolUse && toolUse.type === "tool_use");
    assert.deepEqual(toolUse.input, {});
  });

  it("T-M2: 每块 usageMetadata 累计值变化时 emit usage 事件；值不变不发", () => {
    const usageEvents: Array<{ completionTokens?: number }> = [];
    const onStream = (ev: { type: string; usage?: { completionTokens?: number } }) => {
      if (ev.type === "usage") {
        usageEvents.push(ev.usage ?? {});
      }
    };
    const parser = createGeminiSseParser({ onStream });

    parser.feed(
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":3,"totalTokenCount":13}}',
        "",
        'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":7,"totalTokenCount":17}}',
        "",
        // candidatesTokenCount 不变：不重发（仅 prompt 侧字段变化也不发）
        'data: {"candidates":[{"content":{"parts":[{"text":"!"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":7,"totalTokenCount":17}}',
        "",
      ].join("\n"),
    );

    assert.deepEqual(
      usageEvents.map((u) => u.completionTokens),
      [3, 7],
    );
  });

  it("T-M2: 无候选内容的 usage-only 收尾块也 emit（streamRaw 存储点先于 candidates 早退）", () => {
    const usageEvents: Array<{ completionTokens?: number }> = [];
    const parser = createGeminiSseParser({
      onStream: (ev) => {
        if (ev.type === "usage") {
          usageEvents.push(ev.usage ?? {});
        }
      },
    });
    parser.feed(
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}],"usageMetadata":{"candidatesTokenCount":2,"totalTokenCount":12}}',
        "",
        'data: {"usageMetadata":{"candidatesTokenCount":9,"totalTokenCount":19}}',
        "",
      ].join("\n"),
    );
    assert.deepEqual(
      usageEvents.map((u) => u.completionTokens),
      [2, 9],
    );
  });

  it("T-M2: 块缺 usageMetadata 时不 emit 不报错", () => {
    let usageCount = 0;
    const parser = createGeminiSseParser({
      onStream: (ev) => {
        if (ev.type === "usage") {
          usageCount += 1;
        }
      },
    });
    parser.feed('data: {"candidates":[{"content":{"parts":[{"text":"x"}],"role":"model"}}]}\n');
    assert.equal(usageCount, 0);
  });

});
