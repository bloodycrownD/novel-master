/**
 * C1-10：中断（partial）路径必须与正常收尾路径一样保留 `thinkingSignature`。
 *
 * 修复前 `StreamPartialToolUse` 类型里根本没有该字段、thinking 块构造也不带签名
 * ⇒ 同一份输入「正常收尾带签名、中断收尾不带」，回传时无签名的 thought/thinking
 * 块会被 400。核心断言是**两条路径的 `(type, thinkingSignature)` 序列一致**。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGeminiSseParser } from "../../../src/infra/llm-protocol/logic/gemini-sse-parser.js";
import { createAnthropicSseParser } from "../../../src/infra/llm-protocol/logic/anthropic-sse-parser.js";

type Block = { type: string; thinkingSignature?: string } & Record<
  string,
  unknown
>;

function signatureShape(blocks: readonly unknown[]): Array<[string, unknown]> {
  return (blocks as Block[]).map((b) => [b.type, b.thinkingSignature]);
}

function geminiChunk(parts: unknown[]): string {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts, role: "model" } }],
  })}\n\n`;
}

describe("中断 partial 与正常收尾的 thinkingSignature 对称性", () => {
  it("T-SPS1 gemini：有文本档 + signature-only 档两条路径签名序列一致", () => {
    // 档①：thinking 有文本。
    const feedWithText = (parser: ReturnType<typeof createGeminiSseParser>) => {
      parser.feed(
        geminiChunk([
          { text: "thinking", thought: true, thought_signature: "SIG" },
          {
            functionCall: { name: "read", args: { path: "/a" }, thought_signature: "SIG2" },
          },
        ]),
      );
    };
    const normal1 = createGeminiSseParser();
    feedWithText(normal1);
    const abort1 = createGeminiSseParser();
    feedWithText(abort1);
    assert.deepEqual(
      signatureShape(abort1.finishPartial().blocks),
      signatureShape(normal1.finish().blocks),
      "有文本档：中断与正常收尾的 (type, thinkingSignature) 序列必须相同",
    );

    // 档②：signature-only（thinking 文本为空、只有签名——Claude 4+ 的常态形态）。
    const feedSignatureOnly = (
      parser: ReturnType<typeof createGeminiSseParser>
    ) => {
      parser.feed(
        geminiChunk([
          { thought: true, thought_signature: "SIG_ONLY" },
          {
            functionCall: { name: "read", args: { path: "/a" }, thought_signature: "SIG2" },
          },
        ]),
      );
    };
    const normal2 = createGeminiSseParser();
    feedSignatureOnly(normal2);
    const abort2 = createGeminiSseParser();
    feedSignatureOnly(abort2);
    // 这条在「只补字段、不放宽 thinking 守卫」的实现下必红——它就是放宽守卫的牙齿。
    assert.deepEqual(
      signatureShape(abort2.finishPartial().blocks),
      signatureShape(normal2.finish().blocks),
      "signature-only 档：中断与正常收尾必须仍然对称",
    );
  });

  it("T-SPS2 anthropic：thinking + tool_use 两块签名两条路径一致（两档）", () => {
    const lines = (withText: boolean) =>
      [
        'data: {"type":"content_block_start","content_block":{"type":"thinking","thinking":""}}',
        "",
        withText
          ? 'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"plan"}}'
          : "",
        "",
        'data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"SIG"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"t1","name":"read"}}',
        "",
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}',
        "",
        'data: {"type":"content_block_stop"}',
        "",
      ]
        .filter((l) => l !== "")
        .join("\n");

    for (const withText of [true, false]) {
      const normal = createAnthropicSseParser();
      normal.feed(lines(withText));
      const abort = createAnthropicSseParser();
      abort.feed(lines(withText));
      assert.deepEqual(
        signatureShape(abort.finishPartial().blocks),
        signatureShape(normal.finish().blocks),
        `anthropic withText=${withText}：两条路径签名序列必须相同`,
      );
    }
  });

  it("T-SPS3 无签名输入不产生 thinkingSignature 键（严格 deepEqual）", () => {
    const parser = createGeminiSseParser();
    parser.feed(geminiChunk([{ text: "plain" }]));
    const blocks = parser.finishPartial().blocks as Block[];
    for (const b of blocks) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(b, "thinkingSignature"),
        false,
        "无签名时不得凭空造出该键",
      );
    }
  });

  it("T-SPS4 流事件 tool-use 不带签名字段", () => {
    const events: Array<Record<string, unknown>> = [];
    const onStream = (ev: unknown) => events.push(ev as Record<string, unknown>);
    const parser = createGeminiSseParser({ onStream });
    parser.feed(
      geminiChunk([
        {
          functionCall: { name: "read", args: { path: "/a" }, thought_signature: "SIG2" },
        },
      ]),
    );
    parser.finishPartial();
    const toolUseEvents = events.filter((e) => e["type"] === "tool-use");
    assert.ok(toolUseEvents.length >= 1);
    for (const e of toolUseEvents) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(e, "thinkingSignature"),
        false,
        "LlmStreamEvent 的 tool-use 变体不扩该字段",
      );
    }
  });
});
