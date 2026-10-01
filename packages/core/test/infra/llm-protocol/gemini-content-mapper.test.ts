import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatMessagesToGeminiContents,
  geminiPartsToBlocks,
  toolsToGeminiFunctionDeclarations,
} from "../../../src/infra/llm-protocol/logic/gemini-content-mapper.js";
import type { ChatMessage } from "../../../src/domain/chat/model/message.js";
import { normalizeOrphanToolResultsForLlm } from "../../../src/service/prompt/normalize-orphan-tool-results-for-llm.js";

describe("gemini-content-mapper", () => {
  it("T5: multi-turn history with tool_result", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: { blocks: [{ type: "text", text: "read file" }] },
      },
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(messages);
    assert.ok(contents.length >= 3);
    const toolResultTurn = contents.find((c) =>
      c.parts.some((p) => p.functionResponse != null),
    );
    assert.ok(toolResultTurn);
    const fr = toolResultTurn!.parts.find((p) => p.functionResponse != null)
      ?.functionResponse as { name: string };
    assert.equal(fr.name, "read");
  });

  it("outbound tool_result uses function name on functionResponse.name", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(messages);
    const toolResultTurn = contents.find((c) =>
      c.parts.some((p) => p.functionResponse != null),
    );
    assert.ok(toolResultTurn);
    const fr = toolResultTurn!.parts.find((p) => p.functionResponse != null)
      ?.functionResponse as { name: string };
    assert.equal(fr.name, "read");
  });

  it("inbound functionResponse.name resolves to NM toolUseId", () => {
    const blocks = geminiPartsToBlocks(
      [
        {
          functionResponse: {
            name: "read",
            response: { output: "file body" },
          },
        },
      ],
      { toolUseIdByFunctionName: new Map([["read", "call_1"]]) },
    );
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_result");
    if (blocks[0]?.type === "tool_result") {
      assert.equal(blocks[0].toolUseId, "call_1");
    }
  });

  it("round-trips functionCall to tool_use", () => {
    const blocks = geminiPartsToBlocks([
      {
        functionCall: { name: "read", args: { path: "/b" } },
      },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "tool_use");
    if (blocks[0]?.type === "tool_use") {
      assert.equal(blocks[0].name, "read");
    }
  });

  it("resolves function name from hidden tool_use via lookup messages", () => {
    const lookupMessages: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
    ];
    const visible: ChatMessage[] = [
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(visible, {
      toolLookupMessages: lookupMessages,
    });
    const toolResultTurn = contents.find((c) =>
      c.parts.some((p) => p.functionResponse != null),
    );
    assert.ok(toolResultTurn);
    const fr = toolResultTurn!.parts.find((p) => p.functionResponse != null)
      ?.functionResponse as { name: string; id: string };
    assert.equal(fr.name, "read");
    assert.equal(fr.id, "call_1");
  });

  it("injects synthetic model functionCall when tool_use turn is hidden", () => {
    const lookupMessages: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
    ];
    const visible: ChatMessage[] = [
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(visible, {
      toolLookupMessages: lookupMessages,
    });
    assert.equal(contents.length, 2);
    assert.equal(contents[0]?.role, "model");
    assert.ok(contents[0]?.parts.some((p) => p.functionCall != null));
    assert.equal(contents[1]?.role, "user");
    assert.ok(contents[1]?.parts.some((p) => p.functionResponse != null));
  });

  it("assembly normalize + gemini mapper never emits functionResponse for orphan tool_result", () => {
    const visible: ChatMessage[] = [
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
    ];
    const normalized = normalizeOrphanToolResultsForLlm(visible);
    const contents = chatMessagesToGeminiContents(normalized);
    assert.equal(contents[0]?.role, "user");
    assert.equal(contents[0]?.parts[0]?.functionResponse, undefined);
    assert.match(contents[0]?.parts[0]?.text as string, /file body/);
  });

  it("orphaned tool_result falls back to plain user text (compaction-safe)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(messages);
    assert.equal(contents.length, 1);
    assert.equal(contents[0]?.role, "user");
    const text = contents[0]?.parts[0]?.text as string;
    assert.match(text, /\[tool_result id=call_1\]/);
    assert.match(text, /file body/);
    assert.equal(contents[0]?.parts[0]?.functionResponse, undefined);
  });

  it("orphaned tool_result without toolUseId still serializes as user text", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: {
          blocks: [{ type: "tool_result", content: "ok" } as never],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(messages);
    const text = contents[0]?.parts[0]?.text as string;
    assert.match(text, /\[tool_result/);
    assert.equal(contents[0]?.parts[0]?.functionResponse, undefined);
  });

  it("非 thought 正文含内嵌标签时原样进 text，不挖入 thinking", () => {
    const blocks = geminiPartsToBlocks([
      { text: "plan", thought: true },
      { text: "<thought>leak</thought>你好。" },
    ]);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "thinking");
    assert.equal(blocks[1]?.type, "text");
    if (blocks[0]?.type === "thinking" && blocks[1]?.type === "text") {
      assert.equal(blocks[0].text, "plan");
      assert.equal(blocks[1].text, "<thought>leak</thought>你好。");
    }
  });

  it("T-PM2: 相邻 user 合并后 functionResponse part 与 text part 同 content，且前置", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [{ type: "text", text: "继续读下一个文件" }],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(messages);
    const userTurns = contents.filter((c) => c.role === "user");
    assert.equal(userTurns.length, 1);
    const parts = userTurns[0]!.parts;
    assert.equal(parts.length, 2);
    assert.ok(parts[0]?.functionResponse != null);
    assert.equal(
      (parts[0]!.functionResponse as { name: string }).name,
      "read",
    );
    assert.equal(parts[1]?.text, "继续读下一个文件");
  });

  it("T-PM2: 合成 model turn 修补后再合并相邻 user，model turn 不被吞", () => {
    const lookupMessages: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read",
              input: { path: "/a" },
            },
          ],
        },
      },
    ];
    const visible: ChatMessage[] = [
      {
        role: "user",
        content: {
          blocks: [
            {
              type: "tool_result",
              toolUseId: "call_1",
              content: "file body",
            },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [{ type: "text", text: "换个话题" }],
        },
      },
    ];

    const contents = chatMessagesToGeminiContents(visible, {
      toolLookupMessages: lookupMessages,
    });
    assert.equal(contents.length, 2);
    assert.equal(contents[0]?.role, "model");
    assert.ok(contents[0]?.parts.some((p) => p.functionCall != null));
    assert.equal(contents[1]?.role, "user");
    const parts = contents[1]!.parts;
    assert.ok(parts[0]?.functionResponse != null);
    assert.equal(parts[1]?.text, "换个话题");
  });

  it("W2 收窄等价：可见-only 查找源与全量源对已归一化历史输出逐字段全等", () => {
    // 可见段：assistant tool_use(call_1) + 配对的 user tool_result；另有 hidden 段一对
    const visible: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            { type: "tool_use", id: "call_1", name: "read", input: { path: "/a" } },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [{ type: "tool_result", toolUseId: "call_1", content: "file body" }],
        },
      },
    ];
    const hidden: ChatMessage[] = [
      {
        role: "assistant",
        content: {
          blocks: [
            { type: "tool_use", id: "call_9", name: "grep", input: { pattern: "x" } },
          ],
        },
      },
      {
        role: "user",
        content: {
          blocks: [{ type: "tool_result", toolUseId: "call_9", content: "grep body" }],
        },
      },
    ];
    const fullSource = [...visible, ...hidden];
    // 非恒真前提：全量源确实多带了 hidden 行
    assert.ok(fullSource.length > visible.length);

    // 生产链路口径：出站历史先过 orphan 归一化（agent-runner 每步都做）
    const outbound = normalizeOrphanToolResultsForLlm(visible);
    const withVisible = chatMessagesToGeminiContents(outbound, {
      toolLookupMessages: visible,
    });
    const withFull = chatMessagesToGeminiContents(outbound, {
      toolLookupMessages: fullSource,
    });
    assert.deepEqual(withVisible, withFull, "归一化后可见源与全量源逐字段等价");
    // 解析确实发生（functionResponse 带合法 name），不是两边都拍平成 text
    const fr = withVisible
      .flatMap((c) => c.parts)
      .find((p) => p.functionResponse != null)?.functionResponse as {
      name: string;
    };
    assert.equal(fr.name, "read");

    // 边界反例（牙齿）：tool_result 的 tool_use 只存在于 hidden 段时，两种源
    // 必然分叉（全量源能解析出 functionResponse + 合成 model turn，可见源
    // 只能拍平成 text）——这正是「可见-only 够用」所依赖的前提：runner 每步
    // 都先做 orphan 归一化，这类 tool_result 在到达 mapper 前已拍平。
    // 若 runner 不再归一化，上面的等价断言失效，本用例转红提示回退全量源。
    const orphanOnly = [hidden[1]!];
    const rawWithVisible = chatMessagesToGeminiContents(orphanOnly, {
      toolLookupMessages: visible,
    });
    const rawWithFull = chatMessagesToGeminiContents(orphanOnly, {
      toolLookupMessages: fullSource,
    });
    assert.notDeepEqual(
      rawWithVisible,
      rawWithFull,
      "未归一化历史下两种源必然分叉"
    );
    // 归一化后（生产口径）两者重新等价：孤儿 tool_result 已被拍平
    const normalizedOrphan = normalizeOrphanToolResultsForLlm(orphanOnly);
    assert.deepEqual(
      chatMessagesToGeminiContents(normalizedOrphan, {
        toolLookupMessages: visible,
      }),
      chatMessagesToGeminiContents(normalizedOrphan, {
        toolLookupMessages: fullSource,
      })
    );
  });

  it("toolsToGeminiFunctionDeclarations wraps schemas", () => {
    const tools = toolsToGeminiFunctionDeclarations([
      { name: "read", description: "read", inputSchema: { type: "object" } },
    ]);
    assert.equal(tools.length, 1);
    const decls = (tools[0] as { functionDeclarations: unknown[] }).functionDeclarations;
    assert.equal(decls.length, 1);
  });
});
