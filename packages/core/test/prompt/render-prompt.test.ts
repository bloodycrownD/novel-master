import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks, type ChatMessage } from "@novel-master/core/chat";

import {
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
  buildPromptPreviewSegmentsFromLayout,
  computeLlmExportZonesFromLayout,
  formatPromptLlmInputForCliFromLayout,
  messageBodyText,
  type AgentPromptLayout,
} from "@novel-master/core/prompt";
import { TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";

const fixedNow = new Date(2026, 4, 24, 9, 0, 0);

function message(role: string, content: string, seq: number): ChatMessage {
  return {
    id: `m${seq}`,
    sessionId: "s1",
    seq,
    role,
    content: textBlocks(content),
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

const sampleLayout: AgentPromptLayout = {
  system: "ctx",
  persistEnabled: true,
  persist: [{ name: "u", type: "text", role: "user", content: "ask" }],
  dynamic: [],
};

describe("buildPromptLlmInputFromLayout", () => {
  it("extracts system field, persist synthetic messages, and chat", async () => {
    const messages = [message("user", "{{literal}}", 1)];
    const input = await buildPromptLlmInputFromLayout(sampleLayout, {
      worktreeDisplay: "WT",
      messages,
      now: fixedNow,
    });
    assert.equal(input.system, "ctx");
    assert.equal(input.messages.length, 2);
    assert.equal(input.messages[0]!.id, "prompt:u");
    assert.equal(input.messages[1]!.id, "m1");
    assert.equal(messageBodyText(input.messages[0]!), "ask");
  });

  it("T-WT4: worktree 块注入 user 树 + assistant done 双消息", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: true,
      persist: [
        { name: "tail", type: "text", role: "assistant", content: "ok" },
      ],
      dynamic: [],
    };
    const input = await buildPromptLlmInputFromLayout(layout, {
      worktreeDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
    });
    assert.equal(input.messages.length, 4);
    assert.equal(input.messages[0]!.id, "prompt:workplace");
    assert.equal(input.messages[0]!.role, "user");
    assert.equal(messageBodyText(input.messages[0]!), "WT");
    assert.equal(input.messages[1]!.id, "prompt:workplace:done");
    assert.equal(input.messages[1]!.role, "assistant");
    assert.equal(messageBodyText(input.messages[1]!), TOOL_TURN_BRIDGE_TEXT);
  });

  it("T-WT5: 无 worktree 块时不注入双消息", async () => {
    const layout: AgentPromptLayout = {
      persistEnabled: true,
      persist: [{ name: "u", type: "text", role: "assistant", content: "ask" }],
      dynamic: [],
    };
    const input = await buildPromptLlmInputFromLayout(layout, {
      worktreeDisplay: "WT",
      messages: [],
      now: fixedNow,
    });
    assert.equal(input.messages.length, 1);
    assert.equal(input.messages[0]!.id, "prompt:u");
    assert.ok(input.messages.every((m) => !m.id.includes("worktree")));
  });
});

describe("buildPromptAssemblyFromLayout worktree", () => {
  it("T-WT4b: 预览含 prompt-worktree 双段且 persistEnabled=false 仍注入", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: false,
      persist: [],
      dynamic: [],
    };
    const ctx = { worktreeDisplay: "WT", messages: [], now: fixedNow };
    const segments = await buildPromptAssemblyFromLayout(layout, ctx);
    const wt = segments.find((s) => s.id === "prompt-workplace");
    const done = segments.find((s) => s.id === "prompt-workplace-done");
    assert.equal(wt?.role, "user");
    assert.equal(wt?.body, "WT");
    assert.equal(done?.role, "assistant");
    assert.equal(done?.body, TOOL_TURN_BRIDGE_TEXT);
    assert.ok(segments.every((s) => !s.id.startsWith("persist-")));
  });

  it("T-WT8: 全 layout 顺序 worktree 对 → persist 文本 → chat → dynamic", async () => {
    const layout: AgentPromptLayout = {
      system: "sys",
      workplace: true,
      persistEnabled: true,
      dynamicEnabled: true,
      persist: [
        { name: "persona", type: "text", role: "user", content: "人设" },
        { name: "tail", type: "text", role: "assistant", content: "ok" },
      ],
      dynamic: [
        {
          name: "state",
          type: "text",
          role: "user",
          content: "dyn",
          lifecycle: "once",
        },
      ],
    };
    const messages = [message("user", "hi", 1)];
    const ctx = { worktreeDisplay: "WT", messages, now: fixedNow };
    const input = await buildPromptLlmInputFromLayout(layout, ctx, {
      agentStepIndex: 0,
    });
    assert.deepEqual(
      input.messages.map((m) => m.id),
      [
        "prompt:workplace",
        "prompt:workplace:done",
        "prompt:persona",
        "prompt:tail",
        "m1",
        "prompt:state",
      ]
    );
    const segments = await buildPromptAssemblyFromLayout(layout, ctx, {
      agentStepIndex: 0,
    });
    const templateIds = segments
      .filter((s) => s.source === "template")
      .map((s) => s.id);
    assert.deepEqual(templateIds, [
      "prompt-workplace",
      "prompt-workplace-done",
      "persist-persona",
      "persist-tail",
      "dynamic-state",
    ]);
  });
});

describe("buildPromptPreviewSegmentsFromLayout", () => {
  it("segments join to the same text as formatPromptLlmInputForCliFromLayout", async () => {
    const messages = [message("user", "{{literal}}", 1)];
    const ctx = { worktreeDisplay: "WT", messages, now: fixedNow };
    const segments = await buildPromptPreviewSegmentsFromLayout(
      sampleLayout,
      ctx
    );
    const joined = segments
      .map((s) => {
        const trimmed = s.body.replace(/\r\n/g, "\n");
        if (trimmed === "") {
          return `${s.role}: `;
        }
        const lines = trimmed.split("\n");
        if (lines.length === 1) {
          return `${s.role}: ${lines[0]}`;
        }
        return `${s.role}: ${lines[0]}\n${lines.slice(1).join("\n")}`;
      })
      .join("\n");
    assert.equal(
      joined,
      await formatPromptLlmInputForCliFromLayout(sampleLayout, ctx)
    );
  });
});

describe("formatPromptLlmInputForCliFromLayout", () => {
  it("renders system + persist + chat in order", async () => {
    const messages = [message("user", "{{literal}}", 1)];
    const out = await formatPromptLlmInputForCliFromLayout(sampleLayout, {
      worktreeDisplay: "WT",
      messages,
      now: fixedNow,
    });
    assert.equal(out, "system: ctx\nuser: ask\nuser: {{literal}}");
  });
});

describe("buildPromptAssemblyFromLayout", () => {
  it("includes system segment first", async () => {
    const segments = await buildPromptAssemblyFromLayout(sampleLayout, {
      worktreeDisplay: "",
      messages: [],
    });
    assert.equal(segments[0]!.source, "system");
  });

  it("UA 两段按两条普通 message 展示（不合并摘要）", async () => {
    const actionXml = '<action name="delete">\n{"path":"/test.md"}\n</action>';
    const wrapped = `<system-message>\n${actionXml}\n</system-message>`;
    const messages: ChatMessage[] = [
      {
        id: "u1",
        sessionId: "s1",
        seq: 10,
        role: "user",
        content: textBlocks(wrapped),
        provider: null,
        raw: { metadata: { kind: "user_vfs_action" } },
        createdAtMs: 10,
        hidden: false,
      },
      {
        id: "a1",
        sessionId: "s1",
        seq: 11,
        role: "assistant",
        content: textBlocks("收到通知"),
        provider: null,
        raw: { metadata: { kind: "user_vfs_ack" } },
        createdAtMs: 11,
        hidden: false,
      },
    ];
    const layout: AgentPromptLayout = {
      persistEnabled: false,
      persist: [],
      dynamic: [],
    };
    const segments = await buildPromptAssemblyFromLayout(layout, {
      worktreeDisplay: "",
      messages,
    });
    const chat = segments.filter((s) => s.source === "message");
    assert.equal(chat.length, 2);
    assert.match(chat[0]!.body, /<action\b/);

    assert.equal(chat[1]!.body, "收到通知");
    assert.ok(chat.every((s) => !s.body.includes("【用户 VFS 操作】")));
  });
});

describe("persistEnabled / dynamicEnabled 开关", () => {
  it("persistEnabled=false 跳过 persist 区", async () => {
    const layout: AgentPromptLayout = {
      persistEnabled: false,
      persist: [{ name: "u", type: "text", role: "user", content: "ask" }],
      dynamic: [],
    };
    const ctx = {
      worktreeDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
    };
    const input = await buildPromptLlmInputFromLayout(layout, ctx);
    assert.equal(input.messages.length, 1);
    assert.equal(input.messages[0]!.id, "m1");

    const segments = await buildPromptAssemblyFromLayout(layout, ctx);
    assert.ok(segments.every((s) => !s.id.startsWith("persist-")));
  });

  it("dynamicEnabled=false 跳过 dynamic 区", async () => {
    const layout: AgentPromptLayout = {
      dynamicEnabled: false,
      persist: [],
      dynamic: [
        {
          name: "kick",
          type: "text",
          role: "user",
          content: "go",
          lifecycle: "once",
        },
      ],
    };
    const input = await buildPromptLlmInputFromLayout(
      layout,
      {
        worktreeDisplay: "",
        messages: [],
        now: fixedNow,
      },
      { agentStepIndex: 0 }
    );
    assert.equal(input.messages.length, 0);

    const segments = await buildPromptAssemblyFromLayout(
      layout,
      {
        worktreeDisplay: "",
        messages: [],
      },
      { agentStepIndex: 0 }
    );
    assert.ok(segments.every((s) => !s.id.startsWith("dynamic-")));
  });

  it("T-WT6: persistEnabled=false + worktree 仅双消息无 persist 文本", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: false,
      persist: [
        { name: "u", type: "text", role: "user", content: "ask" },
      ],
      dynamic: [],
    };
    const ctx = {
      worktreeDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
    };
    const input = await buildPromptLlmInputFromLayout(layout, ctx);
    assert.equal(input.messages.length, 3);
    assert.equal(input.messages[0]!.id, "prompt:workplace");
    assert.equal(input.messages[1]!.id, "prompt:workplace:done");
    assert.equal(input.messages[2]!.id, "m1");
    assert.ok(input.messages.every((m) => !m.id.startsWith("prompt:u")));

    const segments = await buildPromptAssemblyFromLayout(layout, ctx);
    assert.ok(segments.some((s) => s.id === "prompt-workplace"));
    assert.ok(segments.every((s) => !s.id.startsWith("persist-")));
  });

  it("worktreeDisplay 空时不注入 worktree 双段（避免 OpenAI 缺 content）", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: false,
      persist: [],
      dynamic: [],
    };
    const ctx = {
      worktreeDisplay: "",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
    };
    const input = await buildPromptLlmInputFromLayout(layout, ctx);
    assert.equal(input.messages.length, 1);
    assert.equal(input.messages[0]!.id, "m1");
    const zones = computeLlmExportZonesFromLayout(layout, {
      worktreeDisplay: "",
    });
    assert.equal(zones.persistCount, 0);
  });

  it("T-WT7: wire role assistant on canon 仍注入 user+done", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: false,
      persist: [],
      dynamic: [],
    };
    const ctx = { worktreeDisplay: "WT", messages: [], now: fixedNow };
    const input = await buildPromptLlmInputFromLayout(layout, ctx);
    assert.equal(input.messages[0]!.role, "user");
    assert.equal(input.messages[1]!.role, "assistant");
    assert.equal(messageBodyText(input.messages[1]!), TOOL_TURN_BRIDGE_TEXT);

    const segments = await buildPromptAssemblyFromLayout(layout, ctx);
    const wt = segments.find((s) => s.id === "prompt-workplace");
    const done = segments.find((s) => s.id === "prompt-workplace-done");
    assert.equal(wt?.role, "user");
    assert.equal(done?.role, "assistant");
  });
});

describe("computeLlmExportZonesFromLayout", () => {
  it("T-WT9: persistCount 含 worktree 双消息", () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: true,
      persist: [
        { name: "p1", type: "text", role: "user", content: "a" },
        { name: "p2", type: "text", role: "assistant", content: "b" },
      ],
      dynamic: [],
    };
    const zones = computeLlmExportZonesFromLayout(layout);
    assert.equal(zones.persistCount, 4);
  });
});
