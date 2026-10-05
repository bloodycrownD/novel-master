import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildAttachmentActionXml,
  buildDirTreeActionXml,
  buildFileRefActionXml,
  textBlocks,
  wrapUserMessageForLlm,
  type ChatMessage,
  type ContentBlock,
} from "@novel-master/core/chat";

import {
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
  buildPromptPreviewSegmentsFromLayout,
  buildPromptPreviewTurnsFromLayout,
  formatPromptLlmInputForCliFromLayout,
  messageBodyTextFromBlocks,
  type AgentPromptLayout,
  type PromptPreviewTurn,
  type PromptRenderContext,
  type PromptToolGroupCardData,
  type PromptTurnCardData,
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

/** 卡片字数口径：文本/thinking 取 body，组卡取 inputJson + result 正文。 */
function cardChars(turn: { cards: ReadonlyArray<PromptTurnCardData> }): number {
  return turn.cards.reduce(
    (sum, card) =>
      sum +
      (card.type === "toolGroup"
        ? card.inputJson.length + (card.result?.body.length ?? 0)
        : card.body.length),
    0
  );
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
    // 前四轮是合成段（system / workplace / workplace·done / persist-persona），
    // kind = 各段真实消息 role。
    assert.deepEqual(
      turns.map((turn) => turn.kind),
      [
        "system",
        "user",
        "assistant",
        "user",
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
    // kind = 段的真实消息 role（无 template 分类）：workplace 是 user 段、
    // workplace·done 是 assistant 段。
    assert.equal(workplace?.kind, "user");
    assert.equal(workplace?.items[0]?.role, "user");
    assert.equal(turns.find((turn) => turn.id === "prompt-workplace-done")?.kind, "assistant");
  });

  it("ctx 带 workplaceFiles（kkv 快照源头直通）时 workplace 段产文件级组卡（body 已剥行号）", async () => {
    const ctx: PromptRenderContext = {
      ...ctxOf(messages),
      workplaceFiles: [
        { path: "outline/大纲.md", display: "full", body: "1|第一行\n2|第二行" },
        { path: "notes/草稿.txt", display: "filename", body: "1|草稿.txt" },
        { path: "meta/info.md", display: "header", body: "---\ntitle: x\n---" },
      ],
    };
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctx);
    const workplace = turns.find((turn) => turn.id === "prompt-workplace")!;
    assert.equal(workplace.cards.length, 1);
    const card = workplace.cards[0]!;
    assert.equal(card.type, "workplace");
    if (card.type === "workplace") {
      assert.deepEqual(
        card.files.map((file) => [file.path, file.display]),
        [
          ["outline/大纲.md", "full"],
          ["notes/草稿.txt", "filename"],
          ["meta/info.md", "header"],
        ],
      );
      // cards 是显示层口径：`N|` 行号已逐行剥掉（展示档仍是快照原值，不做推断）。
      assert.equal(card.files[0]!.body, "第一行\n第二行");
      assert.equal(card.files[1]!.body, "草稿.txt");
      // 展示档本身不带行号的正文原样透出。
      assert.equal(card.files[2]!.body, "---\ntitle: x\n---");
    }
    // metaText 字数 = 各文件**剥后**正文之和（口径=与用户所见字符一致）。
    const filesChars =
      "第一行\n第二行".length + "草稿.txt".length + "---\ntitle: x\n---".length;
    assert.equal(workplace.metaText, `${filesChars} 字`);
    // 纯函数、不改入参：ctx.workplaceFiles 的原 body 仍带行号（T-PL7 判据②）。
    assert.equal(ctx.workplaceFiles![0]!.body, "1|第一行\n2|第二行");
    // 无结构化数据（缺省 ctx）退普通 text 卡——旧调用方不空窗。
    const legacy = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages));
    const legacyCard = legacy.find((turn) => turn.id === "prompt-workplace")!.cards[0]!;
    assert.equal(legacyCard.type, "text");
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

  it("段上的 seq 真参与轮 id：message 轮 id 为 turn-${seq}，合成段轮不含", async () => {
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages));
    // 合成段轮按 id 前缀识别（kind 已是消息 role，不再可区分来源）。
    const isSynthetic = (turn: PromptPreviewTurn) =>
      !turn.id.startsWith("turn-");
    // m1(user) / m2(assistant 首段起算) / m5(user) / m6(assistant)
    assert.deepEqual(
      turns.filter((turn) => !isSynthetic(turn)).map((turn) => turn.id),
      ["turn-1", "turn-2", "turn-5", "turn-6"]
    );
    // 合成段轮保留段 id 拼法，不带 turn- 前缀；kind = 各段真实消息 role。
    assert.deepEqual(
      turns.filter(isSynthetic).map((turn) => [turn.id, turn.kind]),
      [
        ["system", "system"],
        ["prompt-workplace", "user"],
        ["prompt-workplace-done", "assistant"],
        ["persist-persona", "user"],
      ]
    );
    // assistant 轮内跨了 m2/m3/m4，id 只取首段 seq，轮内段 id 仍是 chat-mN-K
    const assistantTurn = turns.find((turn) => turn.id === "turn-2")!;
    assert.deepEqual(
      assistantTurn.items.map((item) => item.id),
      ["chat-m2-1", "chat-m2-2", "chat-m3-3", "chat-m4-4"]
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

  it("user 轮正文按序拼接；summaryText 取真摘要、metaText 带字数", async () => {
    const messages = [message("user", "第一句", 1), message("assistant", "好", 2)];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const userTurn = turns[0]!;
    assert.equal(userTurn.kind, "user");
    // 旧 summary 字段保留段名形态（兼容面），新 summaryText 才是真摘要
    assert.equal(userTurn.summary, "#1 · user");
    assert.equal(userTurn.summaryText, "第一句");
    assert.equal(userTurn.metaText, "#1 · 3 字");
    assert.equal(userTurn.body, "[#1 · user]\n第一句");
    // user 轮恒一张 text 卡：wrap 后整条文本（发给模型的形态）
    assert.equal(userTurn.cards.length, 1);
    assert.deepEqual(
      userTurn.cards.map((card) => card.id),
      ["card-m1-0"]
    );
    assert.equal(userTurn.cards[0]!.type, "text");
  });
});

describe("T-R3 模板段各自独立", () => {
  it("system / persist / dynamic 各占独立轮（kind=段消息 role），dynamic 排在 chat 之后", async () => {
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
    // message 轮 id 由 seq 生成（turn-1 / turn-2）；合成段轮无 seq，沿用段 id。
    assert.deepEqual(
      turns.map((turn) => turn.id),
      ["system", "persist-persona", "persist-tail", "turn-1", "turn-2", "dynamic-state"]
    );
    // kind = 各段真实消息 role（无 template 分类）。
    assert.deepEqual(
      turns.map((turn) => turn.kind),
      ["system", "user", "assistant", "user", "assistant", "user"]
    );
    // role 为 user / assistant 的 persist / dynamic 合成段仍各自独立成轮
    assert.ok(
      turns
        .filter((turn) => !turn.id.startsWith("turn-"))
        .every((turn) => turn.items.length === 1)
    );
    assert.equal(turns[turns.length - 1]!.summary, "state");
    assert.equal(turns[turns.length - 1]!.body, "[state]\ndyn");
    // 合成段轮：summaryText = 段标题、metaText = 字数；卡片由该轮唯一段直转（id=段 id）
    const dynamicTurn = turns[turns.length - 1]!;
    assert.equal(dynamicTurn.summaryText, "state");
    assert.equal(dynamicTurn.metaText, "3 字");
    assert.deepEqual(
      dynamicTurn.cards.map((card) => ({
        id: card.id,
        role: card.type === "text" ? card.role : null,
        body: card.type === "text" ? card.body : null,
      })),
      [{ id: "dynamic-state", role: "state", body: "dyn" }]
    );
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
    // 旧 summary 字段形态不动（CLI parity 兼容面）
    assert.equal(
      turn.summary,
      `${"长".repeat(69)}… · 工具调用 1 次 · ${expectedChars} 字`
    );
    // 新口径：summaryText 只放真摘要（单行截断），计数全在 metaText
    assert.equal(turn.summaryText, `${"长".repeat(69)}…`);
    // 该轮 tool_use 无 result（悬挂）→ metaText 追加丢失计数位
    assert.equal(
      turn.metaText,
      `#2 · 工具调用 1 次 · ${cardChars(turn)} 字 · 1 丢失`
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
    assert.equal(turns[1]!.summaryText, exact);
    assert.equal(turns[1]!.metaText, "#2 · 工具调用 0 次 · 70 字");
  });

  it("无文本卡（纯工具轮）时 summaryText 用卡片数占位", async () => {
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
    // 旧 summary 字段仍按 items 段数占位
    assert.equal(turn.summary, `2 段 · 工具调用 1 次 · ${expectedChars} 字`);
    // 新口径按卡片数占位（工具结果并进组卡，不单独成卡 → 一张）
    assert.equal(turn.cards.length, 1);
    assert.equal(turn.summaryText, "1 段");
  });

  it("摘要只取 assistant 文本卡：tool_result 回传里的 user 文本不参与", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
      // 工具结果回传消息自带 text 块，role 是 user：不能拿它当 assistant 轮摘要
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: "读完 a.md", ok: true },
        { type: "text", text: "继续" },
      ], 3),
      message("assistant", "收尾", 4),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    assert.equal(turn.kind, "assistant");
    assert.deepEqual(cardTypes(turn), ["toolGroup", "text", "text"]);
    // 摘要取首条 **assistant** 文本卡（「收尾」），不是排在它前面的 user 文本卡（「继续」）
    assert.equal(turn.summaryText, "收尾");
  });

  it("thinking 开 / 关两态：cards 与 metaText 随实际产出变化", async () => {
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
    assert.equal(offTurn.items.length, 2);
    assert.equal(onTurn.items.length, 3);
    // thinking 关：thinking 块不产卡；开：产一张 thinking 卡
    assert.deepEqual(
      offTurn.cards.map((card) => card.type),
      ["toolGroup", "text"]
    );
    assert.deepEqual(
      onTurn.cards.map((card) => card.type),
      ["thinking", "toolGroup", "text"]
    );
    assert.ok(onTurn.items.some((item) => item.role === "thinking"));
    assert.equal(offTurn.summaryText, "回答");
    assert.equal(onTurn.summaryText, "回答");
    assert.equal(
      offTurn.metaText,
      `#2 · 工具调用 1 次 · ${cardChars(offTurn)} 字 · 1 丢失`
    );
    assert.equal(
      onTurn.metaText,
      `#2 · 工具调用 1 次 · ${cardChars(onTurn)} 字 · 1 丢失`
    );
    assert.notEqual(offTurn.metaText, onTurn.metaText);
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

/* ───────────────────────── T-PT 卡片流系列 ───────────────────────── */

type Turn = PromptPreviewTurn;

/** assistant 轮的组卡（过滤掉文本 / thinking 卡）。 */
function groupCards(turn: Turn): PromptToolGroupCardData[] {
  return turn.cards.filter(
    (card): card is PromptToolGroupCardData => card.type === "toolGroup"
  );
}

/** 卡片类型序列（断言顺序用）。 */
function cardTypes(turn: Turn): string[] {
  return turn.cards.map((card) => card.type);
}

/** 带 attachments 的 user 消息（wrap 场景用）。 */
function userMessageWithAttachments(
  content: string,
  seq: number,
  count: number
): ChatMessage {
  return {
    ...blocksMessage("user", textBlocks(content).blocks, seq),
    attachments: Array.from({ length: count }, (_, index) => ({
      name: `a${index}.md`,
      source: "attach" as const,
      type: "text" as const,
      content: "x",
    })),
  };
}

describe("T-PT1 工具调用跨消息配对", () => {
  it("m2 的 tool_use 与 m3 的 tool_result 按 id 收进同一张组卡，status=ok", async () => {
    const messages: ChatMessage[] = [
      message("user", "读一下", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: "读完 a.md", ok: true },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    assert.equal(turn.kind, "assistant");
    // 结果块不单独成卡：收进组卡的 result 格
    assert.deepEqual(cardTypes(turn), ["toolGroup"]);
    const [group] = groupCards(turn);
    assert.equal(group!.id, "group-t1");
    assert.equal(group!.toolName, "read");
    assert.equal(group!.status, "ok");
    assert.equal(group!.parallel, false);
    assert.equal(group!.inputJson, JSON.stringify({ path: "a.md" }, null, 2));
    assert.deepEqual(group!.result, {
      toolUseId: "t1",
      ok: true,
      body: "读完 a.md",
    });
  });

  it("input 为空对象时 inputJson 退化为 CLI 同款单行头", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "list", input: {} },
      ], 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(
      groupCards(turns[1]!)[0]!.inputJson,
      "[tool_use name=list id=t1]"
    );
  });

  it("hidden 消息里的 tool_result 不参与配对 → 对应组卡落 lost", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
      // hidden 不进提示词，其 tool_result 不该把 use 从 lost 救成 ok
      {
        ...blocksMessage("user", [
          { type: "tool_result", toolUseId: "t1", content: "读完 a.md", ok: true },
        ], 3),
        hidden: true,
      },
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const [group] = groupCards(turns[1]!);
    assert.equal(group!.result, null);
    assert.equal(group!.status, "lost");
    assert.match(turns[1]!.metaText, /1 丢失$/);
  });
});

describe("T-PT2 并行工具调用按 id 配对", () => {
  it("一条 assistant 两个 tool_use + 下一条消息两个 tool_result → 两张组卡 parallel=true", async () => {
    const messages: ChatMessage[] = [
      message("user", "一起查", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "tool_use", id: "t2", name: "glob", input: { pattern: "*.ts" } },
      ], 2),
      // 结果乱序回传：按 id 配对而非按位置猜
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t2", content: "命中 3 个", ok: true },
        { type: "tool_result", toolUseId: "t1", content: "读完 a.md", ok: true },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const groups = groupCards(turns[1]!);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.map((card) => card.id),
      ["group-t1", "group-t2"]
    );
    assert.ok(groups.every((card) => card.parallel));
    // t1 配到自己的结果，不被乱序位置带偏
    assert.equal(groups[0]!.result?.body, "读完 a.md");
    assert.equal(groups[1]!.result?.body, "命中 3 个");
    assert.ok(groups.every((card) => card.status === "ok"));
  });

  it("单条 tool_use 时 parallel=false", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(groupCards(turns[1]!)[0]!.parallel, false);
  });
});

describe("T-PT3 失败双路判定", () => {
  it("显式 ok:false 与 legacy 缺省 + Error: 前缀都判 status=error", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑一下", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "tool_use", id: "t2", name: "read", input: { path: "b.md" } },
      ], 2),
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: "Error: 显式失败", ok: false },
        // legacy 行：无 ok 字段，靠 Error: 前缀启发式
        { type: "tool_result", toolUseId: "t2", content: "Error: legacy 失败" },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const groups = groupCards(turns[1]!);
    assert.ok(groups.every((card) => card.status === "error"));
    assert.equal(groups[0]!.result?.ok, false);
    assert.equal(groups[1]!.result?.ok, false);
    // 失败正文原样透出（Error: 前缀不走 JSON 美化）
    assert.equal(groups[0]!.result?.body, "Error: 显式失败");
    assert.equal(groups[1]!.result?.body, "Error: legacy 失败");
  });

  it("legacy 缺省但正文非 Error 前缀 → 判 ok", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: "legacy 成功" },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(groupCards(turns[1]!)[0]!.status, "ok");
  });
});

describe("T-PT4 悬挂 tool_use 丢失占位", () => {
  it("无对应 result 时 result=null、status=lost，槽位保留不消失", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑一下", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "text", text: "先读一下" },
        { type: "tool_use", id: "t2", name: "glob", input: { pattern: "*.ts" } },
      ], 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    // 两个悬挂 use 都在，文本卡顺序不变
    assert.deepEqual(cardTypes(turn), ["toolGroup", "text", "toolGroup"]);
    const groups = groupCards(turn);
    for (const group of groups) {
      assert.equal(group.result, null);
      assert.equal(group.status, "lost");
    }
    assert.deepEqual(
      groups.map((card) => card.id),
      ["group-t1", "group-t2"]
    );
  });
});

describe("T-PT5 user 轮真摘要与计数", () => {
  it("无附件：直取正文首行", async () => {
    const messages: ChatMessage[] = [
      message("user", "帮我看看这段\n第二行不参与摘要", 1),
      message("assistant", "好", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(turns[0]!.summaryText, "帮我看看这段");
  });

  it("有附件 wrap 形态：摘要取 <user-input> 内层首行，不是 <attachment>", async () => {
    const wrapped = [
      "<attachment>",
      "  <user-ops>",
      "    <action name=\"attach\"/>",
      "  </user-ops>",
      "</attachment>",
      "<user-input>",
      "帮我改这段",
      "第二行不参与摘要",
      "</user-input>",
    ].join("\n");
    const messages: ChatMessage[] = [
      userMessageWithAttachments(wrapped, 1, 2),
      message("assistant", "好", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[0]!;
    assert.equal(turn.summaryText, "帮我改这段");
    // 卡片正文 = 完整 wrap 后文本（发给模型的形态）
    assert.equal(turn.cards.length, 1);
    assert.equal(turn.cards[0]!.type, "text");
    assert.equal(
      turn.cards[0]!.type === "text" ? turn.cards[0]!.body : "",
      wrapped
    );
    // 附件计数含 workplace 源附件口径：直接取 attachments.length
    assert.equal(turn.metaText, `#1 · ${wrapped.length} 字 · 附件 2`);
  });

  it("无附件时 metaText 不带附件位", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      message("assistant", "yo", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(turns[0]!.metaText, "#1 · 2 字");
  });

  it("首行超 70 字截断为 slice(0,69) + …", async () => {
    const messages: ChatMessage[] = [
      message("user", "问".repeat(100), 1),
      message("assistant", "好", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(turns[0]!.summaryText, `${"问".repeat(69)}…`);
  });

  it("空正文兜底「（无文本）」", async () => {
    const messages: ChatMessage[] = [
      userMessageWithAttachments(
        ["<attachment>", "</attachment>", "<user-input>", "", "</user-input>"].join("\n"),
        1,
        1
      ),
      message("assistant", "好", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(turns[0]!.summaryText, "（无文本）");
  });
});

describe("T-PT6 合成段轮摘要", () => {
  it("summaryText = 段标题、metaText = 字数", async () => {
    const layout: AgentPromptLayout = {
      system: "系统提示词正文",
      persistEnabled: true,
      persist: [{ name: "persona", type: "text", role: "user", content: "人设" }],
      dynamic: [],
    };
    const messages: ChatMessage[] = [message("user", "hi", 1)];
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages, ""));
    const system = turns[0]!;
    assert.equal(system.kind, "system");
    assert.equal(system.summaryText, "system");
    assert.equal(system.metaText, "7 字");
    // 卡片由该轮唯一段直转：id=段 id、role=段标题、body=段 body
    assert.deepEqual(
      system.cards.map((card) => ({
        id: card.id,
        role: card.type === "text" ? card.role : null,
        body: card.type === "text" ? card.body : null,
      })),
      [{ id: "system", role: "system", body: "系统提示词正文" }]
    );
  });
});

describe("T-PT7 assistant 轮摘要与计数拆分", () => {
  it("纯工具轮无文本卡 → summaryText 用卡片数占位", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: "读完", ok: true },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    assert.equal(turn.summaryText, "1 段");
    assert.equal(turn.metaText, `#2 · 工具调用 1 次 · ${cardChars(turn)} 字`);
  });

  it("metaText 分别计算失败 / 丢失计数并追加", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "tool_use", id: "t2", name: "read", input: { path: "b.md" } },
        { type: "tool_use", id: "t3", name: "read", input: { path: "c.md" } },
        { type: "text", text: "收工" },
      ], 2),
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: "ok1", ok: true },
        { type: "tool_result", toolUseId: "t2", content: "Error: 炸了", ok: false },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    assert.equal(turn.summaryText, "收工");
    // 字数硬编码 74 = 三个 inputJson 各 20（`{\n  "path": "…"\n}`）+ 结果 3 + 9 + 文本 2，
    // 不用自派生 helper 算期望值（同漂不发现）
    assert.equal(
      turn.metaText,
      `#2 · 工具调用 3 次 · 74 字 · 1 失败 · 1 丢失`
    );
    assert.equal(cardChars(turn), 74);
    // 字数单独算：不切旧 summary 拼串
    assert.ok(!turn.metaText.includes("收工"));
  });

  it("无失败 / 丢失时不追加计数位", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      message("assistant", "答", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(turns[1]!.metaText, "#2 · 工具调用 0 次 · 1 字");
  });
});

describe("T-PT8 cards 因果顺序与 items 段序解耦", () => {
  it("items 里 tool_result 段排首位（parity 乱序），cards 仍按块序重建", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "text", text: "读了" },
      ], 2),
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: "读完 a.md", ok: true },
        { type: "text", text: "继续" },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    // items：tool_result 段被 parity 提到 m3 首位
    assert.deepEqual(
      turn.items.map((item) => item.title),
      ["#2 · tool_call", "#2 · assistant", "#3 · tool", "#3 · user"]
    );
    // cards：块序重建——组卡在前、文本卡按各消息块序；结果并进组卡不单独成卡
    assert.deepEqual(cardTypes(turn), ["toolGroup", "text", "text"]);
    assert.equal(groupCards(turn)[0]!.id, "group-t1");
    assert.deepEqual(
      turn.cards
        .filter((card) => card.type === "text")
        .map((card) => (card.type === "text" ? card.body : "")),
      ["读了", "继续"]
    );
  });

  it("card id 走独立命名空间，与段 id 无对应关系", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
        { type: "text", text: "读了" },
      ], 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    assert.deepEqual(
      turn.cards.map((card) => card.id),
      ["group-t1", "card-m2-1"]
    );
    // 段 id 走 chat-<mid>-<全局段序>，与 card-<mid>-<块序> 是两套命名空间
    assert.deepEqual(
      turn.items.map((item) => item.id),
      ["chat-m2-1", "chat-m2-2"]
    );
  });

  it("同消息内多个连续 text 块合并成一张卡，id 取首块 index", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段" },
      ], 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    assert.deepEqual(cardTypes(turn), ["text"]);
    assert.equal(turn.cards[0]!.id, "card-m2-0");
    assert.equal(turn.cards[0]!.type === "text" ? turn.cards[0]!.body : "", "第一段\n\n第二段");
  });
});

describe("T-PT9 items / body / 切轮零改动回归", () => {
  const layout: AgentPromptLayout = {
    system: "sys",
    workplace: "【done】",
    persistEnabled: true,
    dynamic: [],
    persist: [{ name: "persona", type: "text", role: "user", content: "人设" }],
  };
  const messages: ChatMessage[] = [
    message("user", "帮我看看", 1),
    blocksMessage("assistant", [
      { type: "tool_use", id: "t1", name: "read", input: { path: "test.md" } },
      { type: "text", text: "先读文件" },
    ], 2),
    blocksMessage("user", [
      { type: "tool_result", toolUseId: "t1", content: "读完 test.md", ok: true },
    ], 3),
    message("assistant", "改好了", 4),
    message("user", "再改改", 5),
    message("assistant", "行", 6),
  ];

  it("切轮 kind / 轮 id 与新增字段无关", async () => {
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages));
    assert.deepEqual(
      turns.map((turn) => turn.kind),
      ["system", "user", "assistant", "user", "user", "assistant", "user", "assistant"]
    );
    assert.deepEqual(
      turns.map((turn) => turn.id),
      ["system", "prompt-workplace", "prompt-workplace-done", "persist-persona", "turn-1", "turn-2", "turn-5", "turn-6"]
    );
  });

  it("items 与扁平段 deepEqual（CLI parity 面未被 cards 触碰）", async () => {
    const ctx = ctxOf(messages);
    const segments = await buildPromptPreviewSegmentsFromLayout(layout, ctx);
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctx);
    assert.deepEqual(
      turns.flatMap((turn) => turn.items),
      segments
    );
    assert.equal(
      segments.map((segment) => `${segment.role}: ${segment.body}`).join("\n"),
      await formatPromptLlmInputForCliFromLayout(layout, ctx)
    );
  });

  it("body 与 summary 旧字段形态不变（新增字段是纯加法）", async () => {
    const ctx = ctxOf(messages);
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctx);
    const assistantTurn = turns[5]!;
    assert.match(
      assistantTurn.body,
      /^\[#2 · tool_call\]\n\[tool_use name=read id=t1\]/
    );
    assert.equal(assistantTurn.summary.startsWith("先读文件 · 工具调用 1 次 · "), true);
    assert.equal(turns[4]!.summary, "#1 · user");
  });

  it("每轮都产出三个新字段（无 undefined 洞）", async () => {
    const turns = await buildPromptPreviewTurnsFromLayout(layout, ctxOf(messages));
    assert.ok(turns.length > 0);
    for (const turn of turns) {
      assert.equal(typeof turn.summaryText, "string");
      assert.equal(typeof turn.metaText, "string");
      assert.ok(Array.isArray(turn.cards));
      assert.ok(turn.cards.length > 0);
    }
  });
});

describe("T-PT10 thinking 卡门控与 redacted 形态", () => {
  it("includeThinkingBlocks 开 / 关两态 cards 产出差异", async () => {
    const messages: ChatMessage[] = [
      message("user", "想一下", 1),
      blocksMessage("assistant", [
        { type: "thinking", text: "让我想想" },
        { type: "text", text: "答案" },
      ], 2),
    ];
    const ctx = ctxOf(messages, "");
    const off = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctx);
    const on = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctx, {
      includeThinkingBlocks: true,
    });
    assert.deepEqual(cardTypes(off[1]!), ["text"]);
    assert.deepEqual(cardTypes(on[1]!), ["thinking", "text"]);
    const thinkingCard = on[1]!.cards[0]!;
    assert.equal(thinkingCard.id, "card-m2-0");
    assert.equal(thinkingCard.type === "thinking" ? thinkingCard.body : "", "让我想想");
  });

  it("redacted_thinking 产出 body=[redacted thinking] 的 thinking 卡", async () => {
    const messages: ChatMessage[] = [
      message("user", "想一下", 1),
      blocksMessage("assistant", [
        { type: "redacted_thinking", data: "opaque" },
        { type: "text", text: "答案" },
      ], 2),
    ];
    const on = await buildPromptPreviewTurnsFromLayout(
      chatOnlyLayout,
      ctxOf(messages, ""),
      { includeThinkingBlocks: true }
    );
    const turn = on[1]!;
    assert.deepEqual(cardTypes(turn), ["thinking", "text"]);
    assert.equal(
      turn.cards[0]!.type === "thinking" ? turn.cards[0]!.body : "",
      "[redacted thinking]"
    );
  });

  it("thinking 块夹在文本中间时正确切分缓冲卡", async () => {
    const messages: ChatMessage[] = [
      message("user", "想一下", 1),
      blocksMessage("assistant", [
        { type: "text", text: "前段" },
        { type: "thinking", text: "中间思考" },
        { type: "text", text: "后段" },
      ], 2),
    ];
    const on = await buildPromptPreviewTurnsFromLayout(
      chatOnlyLayout,
      ctxOf(messages, ""),
      { includeThinkingBlocks: true }
    );
    const turn = on[1]!;
    assert.deepEqual(cardTypes(turn), ["text", "thinking", "text"]);
    assert.deepEqual(
      turn.cards.map((card) => card.id),
      ["card-m2-0", "card-m2-1", "card-m2-2"]
    );
  });
});

/* ───────────────────── T-PL 行号剥离（仅显示层，wire 不动） ───────────────────── */

/** 带 workplace 段的 layout（workplace 组卡的数据源是 ctx.workplaceFiles）。 */
const workplaceLayout: AgentPromptLayout = {
  workplace: "【done】",
  persistEnabled: false,
  dynamic: [],
};

/** workplace 轮（合成段轮，id = 段 id `prompt-workplace`）。 */
async function workplaceTurnOf(
  files: NonNullable<PromptRenderContext["workplaceFiles"]>
): Promise<PromptPreviewTurn> {
  const ctx: PromptRenderContext = { ...ctxOf([], "WT"), workplaceFiles: files };
  const turns = await buildPromptPreviewTurnsFromLayout(workplaceLayout, ctx);
  return turns.find((turn) => turn.id === "prompt-workplace")!;
}

/** workplace 组卡的 files（断言用：先判类型再取，避免非空断言噪音）。 */
function workplaceFilesOf(turn: PromptPreviewTurn) {
  const card = turn.cards[0]!;
  assert.equal(card.type, "workplace");
  return card.type === "workplace" ? card.files : [];
}

/**
 * 一轮「assistant 工具调用 + tool_result 回传」：组卡的 result.body 即断言对象。
 *
 * @param toolName 工具名（只影响组卡标签，不影响正文判据）。
 * @param content tool_result 原始 content（走 `formatToolResultContentForDisplay`）。
 */
async function toolResultBodyOf(toolName: string, content: string): Promise<string> {
  const messages: ChatMessage[] = [
    message("user", "跑", 1),
    blocksMessage("assistant", [
      { type: "tool_use", id: "t1", name: toolName, input: { path: "a.md" } },
    ], 2),
    blocksMessage("user", [{ type: "tool_result", toolUseId: "t1", content }], 3),
  ];
  const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
  const [group] = groupCards(turns[1]!);
  return group!.result!.body;
}

/** read / skill load 的行号正文（`String(n).padStart(6, " ")` 右对齐）。 */
function readOutputJson(content: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    path: "a.md",
    content,
    totalLines: content.split("\n").length,
    returnedLines: content.split("\n").length,
    truncated: false,
    ...extra,
  });
}

describe("T-PL1 workplace full 档逐行剥行号", () => {
  it("多行 `N|` 每行各剥一次，缩进与内容一字不动", async () => {
    const turn = await workplaceTurnOf([
      { path: "a.md", display: "full", body: "1|第一行\n2|  第二行带缩进\n3|第三行" },
    ]);
    assert.deepEqual(
      workplaceFilesOf(turn).map((file) => file.body),
      ["第一行\n  第二行带缩进\n第三行"]
    );
  });

  it("十位以上行号同样剥（`\\d+` 非固定宽度）", async () => {
    const turn = await workplaceTurnOf([
      { path: "a.md", display: "full", body: "9|第九\n10|第十\n1234|第一千二百三十四" },
    ]);
    assert.equal(workplaceFilesOf(turn)[0]!.body, "第九\n第十\n第一千二百三十四");
  });
});

describe("T-PL2 workplace filename / header 档剥前缀", () => {
  it("filename 档单行 `1|basename` → basename", async () => {
    const turn = await workplaceTurnOf([
      { path: "notes/草稿.txt", display: "filename", body: "1|草稿.txt" },
    ]);
    assert.equal(workplaceFilesOf(turn)[0]!.body, "草稿.txt");
  });

  it("header 档两个兜底文案同形剥前缀，正常 front-matter 行也剥", async () => {
    const turn = await workplaceTurnOf([
      { path: "no-fm.md", display: "header", body: "1|（无 Front Matter）" },
      { path: "empty-fm.md", display: "header", body: "1|（空 Front Matter）" },
      { path: "ok.md", display: "header", body: "1|title: 大纲\n2|tags: [a, b]" },
    ]);
    assert.deepEqual(
      workplaceFilesOf(turn).map((file) => file.body),
      ["（无 Front Matter）", "（空 Front Matter）", "title: 大纲\ntags: [a, b]"]
    );
  });
});

describe("T-PL3 tool result read 行号剥离", () => {
  it("6 位右对齐行号逐行剥掉", async () => {
    const body = await toolResultBodyOf("read", readOutputJson("甲\n乙\n丙"));
    assert.equal(body, "甲\n乙\n丙");
  });

  it("截断追加行（无行号）原样保留", async () => {
    const body = await toolResultBodyOf(
      "read",
      readOutputJson("甲\n乙", { truncated: true, totalLines: 100, nextOffset: 3 })
    );
    assert.equal(body, "甲\n乙\n\nOutput truncated. Total lines: 100. Continue with offset=3.");
  });

  it("已知边界：行号 ≥ 100000 无前导空格，本用例锁定「漏剥」现状（spec 已登记接受）", async () => {
    // `padStart(6, " ")` 在 6 位数时不再补空格 → 形态是 `100000|…`（零前导空格），
    // 与 tool result 判据 `^ +\d+\|` 撞不上，故**漏剥**。此断言是现状锁定，不是期望值：
    // 若将来放宽判据，此用例会红，提示同步更新 spec 的「已知边界」登记。
    const body = await toolResultBodyOf(
      "read",
      readOutputJson("甲", { offset: 100000 })
    );
    assert.match(body, /^100000\|甲$/);
  });
});

describe("T-PL4 tool result 非 read 输出零改动", () => {
  it("skill load 追加行（续读提示 / 附属文件列表）不误剥", async () => {
    const body = await toolResultBodyOf(
      "skill",
      JSON.stringify({
        action: "load",
        content: "甲\n乙",
        version: 1,
        truncated: true,
        files: ["ref/a.md", "ref/b.md"],
      })
    );
    assert.equal(
      body,
      "甲\n乙\n\nOutput truncated.\n续读请用 skill read 的 offset/limit。\n\n附属文件（相对技能目录）：ref/a.md、ref/b.md"
    );
  });

  it("grep 的 `path:line:col:` 输出零改动", async () => {
    const body = await toolResultBodyOf(
      "grep",
      JSON.stringify({
        matches: [{ path: "src/a.ts", line: 12, column: 5, excerpt: "  1|const x = 1" }],
        total: 1,
        truncated: false,
      })
    );
    // excerpt 里恰好含 `  1|` 形态，但它不在行首（前缀是 `src/a.ts:12:5:`），不触剥。
    assert.equal(body, "src/a.ts:12:5:   1|const x = 1");
  });

  it("JSON 兜底输出零改动", async () => {
    const body = await toolResultBodyOf("custom", JSON.stringify({ a: 1, b: "x" }));
    assert.equal(body, '{\n  "a": 1,\n  "b": "x"\n}');
  });
});

describe("T-PL5 原文自身含 `12|34` 只剥外层一次", () => {
  it("workplace body `1|12|34` → `12|34`", async () => {
    const turn = await workplaceTurnOf([
      { path: "a.md", display: "full", body: "1|12|34\n2|12|2024|年报" },
    ]);
    assert.deepEqual(workplaceFilesOf(turn).map((file) => file.body), [
      "12|34\n12|2024|年报",
    ]);
  });

  it("tool result 里内层 `|` 同样只剥一次", async () => {
    // read 输出形态：`     1|12|34` / `     2|7|7|7` → 各剥外层一次。
    const body = await toolResultBodyOf("read", readOutputJson("12|34\n7|7|7"));
    assert.equal(body, "12|34\n7|7|7");
  });

  it("原文行首自带缩进 + 伪行号时只剥外层一次（内层缩进保留）", async () => {
    const turn = await workplaceTurnOf([
      { path: "a.md", display: "full", body: "1|正文\n2|   3|缩进的伪行号" },
    ]);
    assert.equal(workplaceFilesOf(turn)[0]!.body, "正文\n   3|缩进的伪行号");
  });
});

describe("T-PL6 text / thinking 卡不剥（防误伤用户正文）", () => {
  it("assistant 文本卡以 `N|` 开头的正文零改动", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      message("assistant", "1|第一行\n2|第二行", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const textCard = turns[1]!.cards[0]!;
    assert.equal(textCard.type === "text" ? textCard.body : "", "1|第一行\n2|第二行");
  });

  it("thinking 卡正文零改动", async () => {
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      blocksMessage("assistant", [
        { type: "thinking", text: "     1|我在想" },
      ], 2),
    ];
    const on = await buildPromptPreviewTurnsFromLayout(
      chatOnlyLayout,
      ctxOf(messages, ""),
      { includeThinkingBlocks: true }
    );
    const thinkingCard = on[1]!.cards[0]!;
    assert.equal(
      thinkingCard.type === "thinking" ? thinkingCard.body : "",
      "     1|我在想"
    );
  });

  it("user 文本卡（无附件 action）以 `N|` 开头的正文零改动", async () => {
    const messages: ChatMessage[] = [
      message("user", "1|这是用户正文\n2|第二行", 1),
      message("assistant", "好", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const card = turns[0]!.cards[0]!;
    assert.equal(card.type === "text" ? card.body : "", "1|这是用户正文\n2|第二行");
  });
});

describe("T-PL7 wire 不变（三段结构判据）", () => {
  it("① wire 组装链不经 cards 构造路径（源码 import 关系断言）", async () => {
    // 仓内无字节级 golden 机制，故用「源码零交集」作结构判据：wire 链的
    // `render-prompt.ts` 不得引用剥离函数，也不得 import cards 构造模块。
    const src = readFileSync(
      join(import.meta.dirname, "../../src/service/prompt/render-prompt.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /stripWorkplaceLinePrefix/);
    assert.doesNotMatch(src, /stripToolResultLinePrefix/);
    assert.doesNotMatch(src, /stripAttachmentContentLinePrefix/);
    assert.doesNotMatch(src, /prompt-preview-turns/);
    // 反向：cards 构造模块 import wire 组装函数（分叉方向单一）。
    const turnsSrc = readFileSync(
      join(import.meta.dirname, "../../src/service/prompt/prompt-preview-turns.ts"),
      "utf8"
    );
    assert.match(turnsSrc, /buildPromptAssemblyFromLayout/);
  });

  it("① 补充：wire 产物里的行号一字未动（行为面交叉核实）", async () => {
    // wire 的 workplace 段走 `ctx.workplaceDisplay` 展示串（与 cards 的
    // `ctx.workplaceFiles` 是**两条独立通道**）：这里展示串里带行号，wire 原样带。
    const ctx: PromptRenderContext = {
      ...ctxOf([message("user", "hi", 1)], "<file path=\"a.md\">\n1|第一行\n2|第二行\n</file>"),
      workplaceFiles: [{ path: "a.md", display: "full", body: "1|第一行\n2|第二行" }],
    };
    const wire = await buildPromptLlmInputFromLayout(workplaceLayout, ctx);
    const workplaceMsg = wire.messages.find((m) => m.role === "user")!;
    const body = messageBodyTextFromBlocks(workplaceMsg.content.blocks);
    assert.match(body, /1\|第一行\n2\|第二行/);
    // 同一次组装产出的 cards 侧已剥——两条通道各自独立。
    const turns = await buildPromptPreviewTurnsFromLayout(workplaceLayout, ctx);
    assert.deepEqual(
      workplaceFilesOf(turns.find((t) => t.id === "prompt-workplace")!).map((f) => f.body),
      ["第一行\n第二行"]
    );
  });

  it("② 剥离不改入参：cards 是新对象，`ctx.workplaceFiles` 原 body 不变", async () => {
    const files: NonNullable<PromptRenderContext["workplaceFiles"]> = [
      { path: "a.md", display: "full", body: "1|第一行\n2|第二行" },
    ];
    const ctx: PromptRenderContext = { ...ctxOf([], "WT"), workplaceFiles: files };
    const turns = await buildPromptPreviewTurnsFromLayout(workplaceLayout, ctx);
    const card = turns.find((t) => t.id === "prompt-workplace")!.cards[0]!;
    assert.notEqual(card.type === "workplace" ? card.files[0] : null, files[0]);
    assert.equal(files[0]!.body, "1|第一行\n2|第二行");
    assert.deepEqual(Object.keys(files[0]!).sort(), ["body", "display", "path"]);
  });

  it("③ `items` / `.body` 仍带行号（CLI parity 冻结面）", async () => {
    const ctx: PromptRenderContext = {
      ...ctxOf([], "WT"),
      workplaceFiles: [{ path: "a.md", display: "full", body: "1|第一行\n2|第二行" }],
    };
    const turns = await buildPromptPreviewTurnsFromLayout(workplaceLayout, ctx);
    const turn = turns.find((t) => t.id === "prompt-workplace")!;
    // items / body 走 `ctx.workplaceDisplay`，这里用 chat 轮交叉核实同一断言：
    // 轮 body 完全由 items 拼成，段 body 未被剥。
    const messages: ChatMessage[] = [
      message("user", "hi", 1),
      message("assistant", "1|第一行\n2|第二行", 2),
    ];
    const chatTurns = await buildPromptPreviewTurnsFromLayout(
      chatOnlyLayout,
      ctxOf(messages, "")
    );
    const assistantTurn = chatTurns[1]!;
    assert.match(assistantTurn.items[0]!.body, /^1\|第一行\n2\|第二行$/);
    assert.equal(assistantTurn.body, "[#2 · assistant]\n1|第一行\n2|第二行");
    // 段 id 集合与 cards 存在与否无关（parity 面未被剥离改动过）。
    assert.deepEqual(itemIds([turn]), [["prompt-workplace"]]);
  });
});

describe("T-PL8 metaText 字数按剥后正文", () => {
  it("workplace 合成段轮 metaText = 剥后各文件正文之和", async () => {
    const turn = await workplaceTurnOf([
      { path: "a.md", display: "full", body: "1|第一行\n2|第二行" },
      { path: "b.txt", display: "filename", body: "1|b.txt" },
    ]);
    // 手写期望值（不用自派生 helper，同漂不发现）："第一行\n第二行"=7 + "b.txt"=5
    assert.equal(turn.metaText, "12 字");
  });

  it("assistant 轮 metaText 的工具结果字数按剥后正文", async () => {
    const messages: ChatMessage[] = [
      message("user", "跑", 1),
      blocksMessage("assistant", [
        { type: "tool_use", id: "t1", name: "read", input: { path: "a.md" } },
      ], 2),
      blocksMessage("user", [
        { type: "tool_result", toolUseId: "t1", content: readOutputJson("甲\n乙") },
      ], 3),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const turn = turns[1]!;
    // inputJson `{\n  "path": "a.md"\n}` = 20 字 + 剥后 result 正文 3 字 = 23
    assert.equal(turn.metaText, "#2 · 工具调用 1 次 · 23 字");
  });
});

describe("T-PL9 user 附件 JSON 转义形态定向剥离（Step 7）", () => {
  /** 走生产构造器拼 wrap 形态，保证 fixture 与 wire 侧同源。 */
  function userAttachBody(content: string, path = "notes/a.md"): string {
    const actionXml = buildFileRefActionXml({
      action: "userAttach",
      path,
      content,
      display: "full",
    });
    return wrapUserMessageForLlm("看看这个", [
      {
        name: "a.md",
        source: "attach",
        type: "text",
        content: actionXml,
      },
    ]);
  }

  /** user 轮 text 卡正文（唯一的 user 轮卡片）。 */
  async function userCardBody(text: string): Promise<string> {
    const messages: ChatMessage[] = [
      blocksMessage("user", textBlocks(text).blocks, 1),
      message("assistant", "好", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    const card = turns[0]!.cards[0]!;
    return card.type === "text" ? card.body : "";
  }

  it("`\"content\"` 值内的字面 `\\n` 转义行号逐处剥掉", async () => {
    const body = await userCardBody(userAttachBody("1|第一行\n2|第二行\n3|第三行"));
    // 转义形态：值内换行是反斜杠 + n 两字符，剥完仍留转义（不改 JSON 结构）。
    assert.match(body, /"content": "第一行\\n第二行\\n第三行"/);
    assert.doesNotMatch(body, /\\n\d+\|/);
  });

  it("filename 档 `1|basename` 与 header 兜底同样剥前缀", async () => {
    const body = await userCardBody(userAttachBody("1|草稿.txt", "notes/草稿.txt"));
    assert.match(body, /"content": "草稿\.txt"/);
  });

  it("原文含 `12|34` 时只剥外层一次（转义形态同款判据）", async () => {
    const body = await userCardBody(userAttachBody("1|12|34\n2|12|2024|年报"));
    assert.match(body, /"content": "12\|34\\n12\|2024\|年报"/);
  });

  it("annotate 块不动（没有 `content` 键，原文一律不碰）", async () => {
    const actionXml = buildAttachmentActionXml("annotate", {
      path: "notes/a.md",
      originalText: "1|这行不是行号",
      userAnnotation: "2|批注也不是",
    });
    const wrapped = wrapUserMessageForLlm("批注一下", [
      { name: "a.md", source: "user_ops", type: "text", content: actionXml },
    ]);
    assert.equal(await userCardBody(wrapped), wrapped);
  });

  it("`<user-input>` 内层用户正文零改动（摘要取值也不受影响）", async () => {
    const messages: ChatMessage[] = [
      blocksMessage(
        "user",
        textBlocks(userAttachBody("1|附件行")).blocks,
        1
      ),
      message("assistant", "好", 2),
    ];
    const turns = await buildPromptPreviewTurnsFromLayout(chatOnlyLayout, ctxOf(messages, ""));
    assert.equal(turns[0]!.summaryText, "看看这个");
    assert.match(turns[0]!.cards[0]!.type === "text" ? turns[0]!.cards[0]!.body : "", /<user-input>\n看看这个\n<\/user-input>/);
  });

  it("skillAttach 块不动（`content` 是无行号原文，判据不适用）", async () => {
    const actionXml = buildAttachmentActionXml("skillAttach", {
      name: "novel-master",
      content: "第一行\n12|这不是行号",
    });
    const wrapped = wrapUserMessageForLlm("用一下技能", [
      { name: "skill", source: "attach", type: "text", content: actionXml },
    ]);
    const body = await userCardBody(wrapped);
    assert.match(body, /"content": "第一行\\n12\|这不是行号"/);
  });

  it("dirTree 块不动（ASCII 树不构成 `^ *\\d+\\|`）", async () => {
    const actionXml = buildDirTreeActionXml("notes", "notes/\n├── sub/\n└── a.md");
    const wrapped = wrapUserMessageForLlm("看下目录", [
      { name: "notes", source: "attach", type: "text", content: actionXml },
    ]);
    const body = await userCardBody(wrapped);
    assert.match(body, /"content": "notes\/\\n├── sub\/\\n└── a\.md"/);
  });

  it("binary / 超限降级文案零改动", async () => {
    for (const note of ["二进制文件，不提供正文", "文件过长，可用 read 配合 offset/limit 分段读取"]) {
      const actionXml = buildFileRefActionXml({
        action: "userAttach",
        path: "a.bin",
        content: note,
        display: "filename",
      });
      const wrapped = wrapUserMessageForLlm("看下", [
        { name: "a.bin", source: "attach", type: "text", content: actionXml },
      ]);
      assert.equal(await userCardBody(wrapped), wrapped);
    }
  });
});