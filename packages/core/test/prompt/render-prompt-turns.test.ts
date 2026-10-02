import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks, type ChatMessage, type ContentBlock } from "@novel-master/core/chat";

import {
  buildPromptAssemblyFromLayout,
  buildPromptPreviewSegmentsFromLayout,
  buildPromptPreviewTurnsFromLayout,
  formatPromptLlmInputForCliFromLayout,
  type AgentPromptLayout,
  type PromptRenderContext,
} from "@novel-master/core/prompt";

const fixedNow = new Date(2026, 4, 24, 9, 0, 0);

function message(role: string, content: string, seq: number): ChatMessage {
  return blocksMessage(role, textBlocks(content).blocks, seq);
}

function blocksMessage(
  role: string,
  blocks: readonly ContentBlock[],
  seq: number
): ChatMessage {
  return {
    id: `m${seq}`,
    sessionId: "s1",
    seq,
    role,
    content: { blocks },
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

function ctxOf(messages: readonly ChatMessage[], workplaceDisplay = "WT"): PromptRenderContext {
  return { workplaceDisplay, messages, now: fixedNow };
}

/** 无 system / persist / dynamic 的裸 layout，只留 chat 段便于看切轮。 */
const chatOnlyLayout: AgentPromptLayout = {
  persistEnabled: false,
  persist: [],
  dynamic: [],
};

function itemIds(turns: Awaited<ReturnType<typeof buildPromptPreviewTurnsFromLayout>>): string[][] {
  return turns.map((turn) => turn.items.map((item) => item.id));
}

describe("T-R1 切轮正确性", () => {
  const layout: AgentPromptLayout = {
    system: "sys",
    workplace: "【done】",
    persistEnabled: true,
    persist: [{ name: "persona", type: "text", role: "user", content: "人设" }],
    dynamic: [],
  };
  const messages: ChatMessage[] = [
    message("user", "帮我看看", 1),
    blocksMessage("assistant", [
      { type: "tool_use", id: "t1", name: "read", input: { path: "test.md" } },
      { type: "text", text: "先读文件" },
    ], 2),
    blocksMessage("user", [{ type: "tool_result", toolUseId: "t1", content: "读完 test.md" }], 3),
    message("assistant", "改好了", 4),
    message("user", "再改改", 5),
    message("assistant", "行", 6),
  ];

  it("真用户输入开新轮，含 tool_result 的 user 消息归 assistant 轮", async () => {
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages));
    assert.deepEqual(
      turns.map((turn) => turn.kind),
      [
        "template",
        "template",
        "template",
        "template",
        "user",
        "assistant",
        "user",
        "assistant",
      ]
    );
    assert.deepEqual(itemIds(turns), [
      ["system"],
      ["prompt-workplace"],
      ["prompt-workplace-done"],
      ["persist-persona"],
      ["chat-m1-0"],
      // assistant(工具+文本) → tool_result 回传 → assistant 收尾，四段同一轮
      ["chat-m2-1", "chat-m2-2", "chat-m3-3", "chat-m4-4"],
      ["chat-m5-5"],
      ["chat-m6-6"],
    ]);
  });

  it("workplace 合成 user 段（role user、source template）不误切", async () => {
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages));
    const workplace = turns.find((turn) => turn.id === "prompt-workplace");
    assert.equal(workplace?.kind, "template");
    assert.equal(workplace?.items[0]?.role, "user");
    assert.equal(turns.find((turn) => turn.id === "prompt-workplace-done")?.kind, "template");
  });

  it("assembly chat 段带 messageId / seq 供聚合层分组", async () => {
    const segments = await buildPromptAssemblyFromLayout(layout, ctxOf(messages));
    const chat = segments.filter((segment) => segment.source === "message");
    assert.equal(chat.length, 7);
    assert.ok(chat.every((segment) => segment.messageId != null));
    assert.ok(chat.every((segment) => typeof segment.seq === "number"));
    assert.deepEqual(
      chat.map((segment) => segment.seq),
      [1, 2, 2, 3, 4, 5, 6]
    );
    // 模板段不带 messageId / seq
    assert.ok(
      segments.filter((s) => s.source !== "message").every((s) => s.messageId === undefined)
    );
  });
});

describe("T-R2 首轮与空轮守卫", () => {
  it("会话开头无 user 前缀的 assistant 段自成首个 assistant 轮", async () => {
    const messages = [
      message("assistant", "开场白", 1),
      message("user", "hi", 2),
      message("assistant", "yo", 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.deepEqual(
      turns.map((turn) => turn.kind),
      ["assistant", "user", "assistant"]
    );
    assert.deepEqual(itemIds(turns), [
      ["chat-m1-0"],
      ["chat-m2-1"],
      ["chat-m3-2"],
    ]);
    assert.equal(turns[0]!.summary, "开场白 · 工具调用 0 次 · 3 字");
  });

  it("无段的 user 消息不产出空轮", async () => {
    const messages = [message("user", "", 1), message("assistant", "ok", 2)];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.deepEqual(itemIds(turns), [["chat-m2-0"]]);
    assert.ok(turns.every((turn) => turn.items.length > 0));
  });

  it("user 轮正文按序拼接且摘要取首段标题", async () => {
    const messages = [message("user", "第一句", 1), message("assistant", "好", 2)];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const userTurn = turns[0]!;
    assert.equal(userTurn.kind, "user");
    assert.equal(userTurn.summary, "#1 · user");
    assert.equal(userTurn.body, "[#1 · user]\n第一句");
  });
});

describe("T-R3 模板段各自独立", () => {
  it("system / persist / dynamic 各占独立 template 轮，dynamic 排在 chat 之后", async () => {
    const layout: AgentPromptLayout = {
      system: "sys",
      persistEnabled: true,
      dynamicEnabled: true,
      persist: [
        { name: "persona", type: "text", role: "user", content: "人设" },
        { name: "tail", type: "text", role: "assistant", content: "尾注" },
      ],
      dynamic: [{ name: "state", type: "text", role: "user", content: "dyn" }],
    };
    const messages = [message("user", "hi", 1), message("assistant", "yo", 2)];
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages, ""));
    assert.deepEqual(
      turns.map((turn) => turn.id),
      ["system", "persist-persona", "persist-tail", "chat-m1-0", "chat-m2-1", "dynamic-state"]
    );
    assert.deepEqual(
      turns.map((turn) => turn.kind),
      ["template", "template", "template", "user", "assistant", "template"]
    );
    // role 为 user 的 persist / dynamic 合成段仍是 template 轮
    assert.ok(
      turns
        .filter((turn) => turn.kind === "template")
        .every((turn) => turn.items.length === 1)
    );
    assert.equal(turns[turns.length - 1]!.summary, "state");
    assert.equal(turns[turns.length - 1]!.body, "[state]\ndyn");
  });
});

describe("T-R4 assistant 轮摘要", () => {
  it("首行超 70 字截断为 slice(0,69) + …，并带工具调用计数与字符数", async () => {
    const long = "长".repeat(100);
    const messages = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "text", text: `${long}\n第二行不参与摘要` },
      ], 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    assert.equal(turn.kind, "assistant");
    const expectedChars = turn.items.reduce((sum, item) => sum + item.body.length, 0);
    assert.equal(
      turn.summary,
      `${"长".repeat(69)}… · 工具调用 1 次 · ${expectedChars} 字`
    );
    // 正文按序拼接且带角色前缀行
    assert.match(turn.body, /^\[#2 · tool_call\]\n\[tool_use name=read id=t1\]/);
    assert.match(turn.body, /\n\n\[#2 · assistant\]\n/);
  });

  it("首行恰好 70 字不截断", async () => {
    const exact = "字".repeat(70);
    const messages = [message("user", "hi", 1), message("assistant", exact, 2)];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.match(turns[1]!.summary, /^字{70} · 工具调用 0 次 · 70 字$/);
  });

  it("无文本段（纯 thinking + tool_call）时文本位留空、改用段数占位", async () => {
    const messages = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
      blocksMessage("user", [{ type: "tool_result", toolUseId: "t1", content: "读完" }], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    const expectedChars = turn.items.reduce((sum, item) => sum + item.body.length, 0);
    assert.equal(turn.summary, `2 段 · 工具调用 1 次 · ${expectedChars} 字`);
  });

  it("thinking 开 / 关两态摘要随实际产出段变化", async () => {
    const messages = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "thinking", text: "让我想想" },
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "text", text: "回答" },
      ], 2),
    ];
    const ctx = ctxOf(messages, "");
    const off = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctx);
    const on = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctx, {
      includeThinkingBlocks: true,
    });
    const offTurn = off[1]!;
    const onTurn = on[1]!;
    const charCountOf = (turn: { items: ReadonlyArray<{ body: string }> }): number =>
      turn.items.reduce((sum, item) => sum + item.body.length, 0);
    assert.equal(offTurn.items.length, 2);
    assert.equal(onTurn.items.length, 3);
    assert.equal(offTurn.summary, `回答 · 工具调用 1 次 · ${charCountOf(offTurn)} 字`);
    assert.equal(onTurn.summary, `回答 · 工具调用 1 次 · ${charCountOf(onTurn)} 字`);
    assert.ok(onTurn.items.some((item) => item.role === "thinking"));
  });
});

describe("T-R5 CLI parity 契约不受影响", () => {
  it("buildPromptPreviewSegmentsFromLayout join 结果与 CLI 文本一致", async () => {
    const layout: AgentPromptLayout = {
      system: "ctx",
      persistEnabled: true,
      persist: [{ name: "u", type: "text", role: "user", content: "ask" }],
      dynamic: [],
    };
    const ctx = ctxOf([message("user", "{{literal}}", 1)]);
    const segments = await buildPromptPreviewSegmentsFromLayout(layout, ctx);
    const joined = segments
      .map((segment) => `${segment.role}: ${segment.body}`)
      .join("\n");
    assert.equal(joined, await formatPromptLlmInputForCliFromLayout(layout, ctx));
  });

  it("轮聚合不改动段产出（同样的段集合，只是折叠成轮）", async () => {
    const layout: AgentPromptLayout = {
      system: "sys",
      workplace: "【done】",
      persistEnabled: true,
      dynamic: [],
      persist: [{ name: "persona", type: "text", role: "user", content: "人设" }],
    };
    const messages = [message("user", "hi", 1), message("assistant", "yo", 2)];
    const ctx = ctxOf(messages);
    const segments = await buildPromptPreviewSegmentsFromLayout(layout, ctx);
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctx);
    assert.deepEqual(
      turns.flatMap((turn) => turn.items),
      segments
    );
  });
});