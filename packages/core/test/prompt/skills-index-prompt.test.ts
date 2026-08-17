import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks, type ChatMessage } from "@novel-master/core/chat";

import {
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
  computeLlmExportZonesFromLayout,
  type AgentPromptLayout,
  type PromptSkillIndexEntry,
} from "@novel-master/core/prompt";
import { messageBodyText } from "@novel-master/core/prompt";

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

const skillsIndex: readonly PromptSkillIndexEntry[] = [
  { name: "writer", description: "擅长润色文稿", domain: "project" },
  { name: "outliner", description: "", domain: "global" },
];

const fullLayout: AgentPromptLayout = {
  system: "sys",
  workplace: "【done】",
  persistEnabled: true,
  persist: [{ name: "persona", type: "text", role: "user", content: "人设" }],
  dynamicEnabled: true,
  dynamic: [
    { name: "state", type: "text", role: "user", content: "dyn", lifecycle: "once" },
  ],
};

describe("T-SK9: 技能索引段（两套遍历）", () => {
  it("位置：system 后 workplace 前（assembly segments）", async () => {
    const segments = await buildPromptAssemblyFromLayout(fullLayout, {
      workplaceDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
      skillsIndex,
    });
    const ids = segments.map((s) => s.id);
    const systemAt = ids.indexOf("system");
    const skillsAt = ids.indexOf("prompt-skills");
    const workplaceAt = ids.indexOf("prompt-workplace");
    assert.ok(systemAt >= 0 && skillsAt > systemAt);
    assert.ok(workplaceAt < 0 || skillsAt < workplaceAt);
    const skillsSegment = segments[skillsAt]!;
    assert.equal(skillsSegment.title, "skills");
    assert.equal(skillsSegment.role, "user");
    assert.equal(skillsSegment.source, "template");
    assert.match(skillsSegment.body, /- writer：擅长润色文稿（project）/);
    assert.match(skillsSegment.body, /- outliner（global）/);
  });

  it("位置：workplace 合成消息之前（llm input messages）", async () => {
    const input = await buildPromptLlmInputFromLayout(fullLayout, {
      workplaceDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
      skillsIndex,
    });
    assert.deepEqual(input.messages.slice(0, 4).map((m) => m.id), [
      "prompt:skills",
      "prompt:workplace",
      "prompt:workplace:done",
      "prompt:persona",
    ]);
    assert.equal(input.messages[0]!.role, "user");
  });

  it("两套遍历同源：segment body 与合成消息正文一致", async () => {
    const ctx = {
      workplaceDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
      skillsIndex,
    };
    const [segments, input] = await Promise.all([
      buildPromptAssemblyFromLayout(fullLayout, ctx),
      buildPromptLlmInputFromLayout(fullLayout, ctx),
    ]);
    const segment = segments.find((s) => s.id === "prompt-skills")!;
    const synthetic = input.messages.find((m) => m.id === "prompt:skills")!;
    assert.equal(messageBodyText(synthetic), segment.body);
  });

  it("空清单 / 缺省不产生技能索引段", async () => {
    const base = {
      workplaceDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
    };
    for (const ctx of [base, { ...base, skillsIndex: [] }]) {
      const segments = await buildPromptAssemblyFromLayout(fullLayout, ctx);
      assert.ok(segments.every((s) => s.id !== "prompt-skills"));
      const input = await buildPromptLlmInputFromLayout(fullLayout, ctx);
      assert.ok(input.messages.every((m) => m.id !== "prompt:skills"));
    }
  });

  it("zones：persistCount 计入技能索引段（1 条合成消息）", () => {
    const withoutSkills = computeLlmExportZonesFromLayout(fullLayout, {
      workplaceDisplay: "WT",
    });
    const withSkills = computeLlmExportZonesFromLayout(fullLayout, {
      workplaceDisplay: "WT",
      skillsIndex,
    });
    // fullLayout：workplace 双段(2) + persist 文本(1) = 3；技能索引 +1。
    assert.equal(withoutSkills.persistCount, 3);
    assert.equal(withSkills.persistCount, 4);
    // 空清单不计入。
    const emptySkills = computeLlmExportZonesFromLayout(fullLayout, {
      workplaceDisplay: "WT",
      skillsIndex: [],
    });
    assert.equal(emptySkills.persistCount, 3);
  });

  it("zones 边界与 llm input 实际 messages 对齐（persist 前缀切片）", async () => {
    const ctx = {
      workplaceDisplay: "WT",
      messages: [message("user", "hi", 1)],
      now: fixedNow,
      skillsIndex,
    };
    const input = await buildPromptLlmInputFromLayout(fullLayout, ctx);
    const zones = computeLlmExportZonesFromLayout(fullLayout, {
      workplaceDisplay: "WT",
      skillsIndex,
    });
    const persistIds = input.messages
      .slice(0, zones.persistCount)
      .map((m) => m.id);
    assert.deepEqual(persistIds, [
      "prompt:skills",
      "prompt:workplace",
      "prompt:workplace:done",
      "prompt:persona",
    ]);
    assert.equal(
      input.messages[input.messages.length - 1]!.id,
      "prompt:state",
    );
  });
});
