/**
 * C1-8：gemini 同名并行 functionCall 不再塌陷成一个累加器。
 *
 * 修复前归并键是 `fc.id ?? fc.name`，而 argsJson 分支是**赋值不是累加** ⇒
 * 同 chunk 里并行的两个同名调用被压成一条，`blocks` 只剩一条 `tool_use`、
 * 携带最后一次调用的参数（工具调用静默丢失 + 参数串味）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGeminiSseParserState,
  feedGeminiSseChunk,
  finishGeminiSse,
} from "../../../src/infra/llm-protocol/logic/gemini-sse-parser.js";
import { geminiPartsToBlocks } from "../../../src/infra/llm-protocol/logic/gemini-content-mapper.js";

type Block = { type: string } & Record<string, unknown>;

function chunkOf(parts: unknown[]): string {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts, role: "model" } }],
  })}\n\n`;
}

function toolUseBlocks(blocks: readonly unknown[]): Block[] {
  return (blocks as Block[]).filter((b) => b.type === "tool_use");
}

describe("gemini 并行同名 functionCall", () => {
  it("T-GPSN1 并行两个无 id 同名调用 → 2 条 tool_use、args 不串味、id 互异", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      chunkOf([
        { functionCall: { name: "read_file", args: { path: "a.md" } } },
        { functionCall: { name: "read_file", args: { path: "b.md" } } },
      ]),
    );
    const uses = toolUseBlocks(finishGeminiSse(state).blocks);
    assert.equal(uses.length, 2, "修复前只有 1 条（塌陷）");
    assert.equal((uses[0]!.input as { path: string }).path, "a.md");
    assert.equal((uses[1]!.input as { path: string }).path, "b.md");
    assert.notEqual(uses[0]!.id, uses[1]!.id);
    assert.ok(String(uses[0]!.id).startsWith("read_file"));
    assert.ok(String(uses[1]!.id).startsWith("read_file"));
  });

  it("T-GPSN2 单调用跨 chunk 增长 → 仍 1 条、参数取最后完整快照", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(state, chunkOf([{ functionCall: { name: "read_file", args: { path: "a" } } }]));
    feedGeminiSseChunk(
      state,
      chunkOf([{ functionCall: { name: "read_file", args: { path: "a", n: 1 } } }]),
    );
    feedGeminiSseChunk(
      state,
      chunkOf([
        { functionCall: { name: "read_file", args: { path: "a", n: 1, m: 2 } } },
      ]),
    );
    const uses = toolUseBlocks(finishGeminiSse(state).blocks);
    assert.equal(uses.length, 1, "ordinal 不得把同一调用拆成三条");
    assert.deepEqual(uses[0]!.input, { path: "a", n: 1, m: 2 });
  });

  it("T-GPSN3 有 id 时键与修复前逐条一致（不含 #ordinal）", () => {
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(
      state,
      chunkOf([
        { functionCall: { id: "fc-1", name: "read_file", args: { path: "a" } } },
        { functionCall: { id: "fc-2", name: "read_file", args: { path: "b" } } },
      ]),
    );
    const uses = toolUseBlocks(finishGeminiSse(state).blocks);
    assert.equal(uses.length, 2);
    assert.deepEqual(
      uses.map((u) => u.id),
      ["fc-1", "fc-2"],
    );
  });

  it("T-GPSN4 默认案：流式侧 2 条 id 互异、非流式侧 id 与修复前一致", () => {
    const parts = [
      { functionCall: { name: "read_file", args: { path: "a.md" } } },
      { functionCall: { name: "read_file", args: { path: "b.md" } } },
    ];
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(state, chunkOf(parts));
    const streamed = toolUseBlocks(finishGeminiSse(state).blocks);
    assert.equal(streamed.length, 2);
    assert.notEqual(streamed[0]!.id, streamed[1]!.id);

    // 非流式侧**未被本条触碰**：`${name}-${blocks.length}` 形态原样保留。
    const nonStreamed = toolUseBlocks(geminiPartsToBlocks(parts));
    assert.deepEqual(
      nonStreamed.map((u) => u.id),
      ["read_file-0", "read_file-1"],
    );
  });

  it("T-GPSN5 已知边界：同名无 id 调用分处两个 chunk 仍会塌缩（钉死现状 + 标注口径前提）", () => {
    // ⚠️ 本条的 ordinal 口径**依赖「每个 chunk 携带当前完整 parts 快照」**这一
    // SSE 增量语义（Gemini 的实际形态）。若供应商真按「只带新增 part」发，
    // 两个同名调用分处两个 chunk 时 ordinal 都是 0 ⇒ 再次塌缩。
    //
    // 本用例把该边界**钉成期望并显式标注前提**：它不是「通过了就没事」的锁，
    // 而是「口径换实现前必须先解决」的提醒。生产上若真出现该形态（表现为
    // 并行同名调用少执行一条），修法是改用全局序号 + part 位置。
    const state = createGeminiSseParserState();
    feedGeminiSseChunk(state, chunkOf([{ functionCall: { name: "read_file", args: { path: "a.md" } } }]));
    feedGeminiSseChunk(state, chunkOf([{ functionCall: { name: "read_file", args: { path: "b.md" } } }]));
    const uses = toolUseBlocks(finishGeminiSse(state).blocks);
    assert.equal(uses.length, 1, "增量 part 形态下的已知塌缩（R1 未闭合）");
    assert.equal(
      (uses[0]!.input as { path: string }).path,
      "b.md",
      "塌陷时保留最后一次调用的参数（赋值非累加）",
    );
  });
});