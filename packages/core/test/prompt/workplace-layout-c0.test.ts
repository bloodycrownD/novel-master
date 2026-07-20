import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode } from "@novel-master/core";
import { agentDefinitionSchema } from "@novel-master/core/agent";
import { TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";
import {
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
} from "@novel-master/core/prompt";
import {
  assembleWorkplaceDisplay,
  layoutHasWorkplace,
} from "@novel-master/core/workplace";
import { resolveAgentDefinitionFromStorage } from "../../src/config-forms/stored-config-validity/assess-agent-definition-wire.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import {
  createMemorySessionKkv,
  mockWorkplaceService,
} from "../helpers/prompt-layout-test-helpers.js";

const fixedNow = new Date(2026, 4, 24, 9, 0, 0);

describe("Workplace C0 协议", () => {
  it("T-W1: 无 workplace → false；assemble 空串；不注入双消息", async () => {
    const layout: AgentPromptLayout = {
      persist: [],
      dynamic: [],
    };
    assert.equal(layoutHasWorkplace(layout), false);

    const sk = createMemorySessionKkv();
    const wt = mockWorkplaceService("WT");
    const out = await assembleWorkplaceDisplay(
      { kind: "session", projectId: "p", sessionId: "s" },
      {
        sessionKkv: sk,
        workplace: wt,
        vfs: { read: async () => ({ content: "x", mtimeMs: 1 }) } as never,
        layout,
      },
    );
    assert.equal(out.workplaceDisplay, "");
    assert.deepEqual(out.prefixPaths, []);

    const input = await buildPromptLlmInputFromLayout(layout, {
      workplaceDisplay: "WT",
      messages: [],
      now: fixedNow,
    });
    assert.equal(input.messages.length, 0);
  });

  it("T-W2: workplace:true + persistEnabled:false 仍注入 user+done", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: false,
      persist: [{ name: "u", type: "text", role: "user", content: "hidden" }],
      dynamic: [],
    };
    const input = await buildPromptLlmInputFromLayout(layout, {
      workplaceDisplay: "WT",
      messages: [],
      now: fixedNow,
    });
    assert.equal(input.messages.length, 2);
    assert.equal(input.messages[0]!.id, "prompt:workplace");
    assert.equal(input.messages[1]!.id, "prompt:workplace:done");
  });

  it("T-W3: 旧 type:worktree 无 workplace → strip 后 false，不注入", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "legacy",
        prompts: {
          persist: { canon: { type: "worktree" } },
          dynamic: {},
        },
      },
      agentDefinitionSchema,
    );
    assert.equal(def.prompts.workplace, undefined);
    assert.deepEqual(def.prompts.persist, []);
  });

  it("T-W4: 旧块 + workplace:true → 块丢弃、开关开", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "mixed",
        prompts: {
          workplace: true,
          persist: {
            canon: { type: "worktree" },
            intro: { type: "text", role: "user", content: "hi" },
          },
          dynamic: {},
        },
      },
      agentDefinitionSchema,
    );
    assert.equal(def.prompts.workplace, true);
    assert.equal(def.prompts.persist.length, 1);
    assert.equal(def.prompts.persist[0]?.name, "intro");
  });

  it("T-W5: LLM 运行时合成消息 id 为 prompt:workplace / prompt:workplace:done", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persist: [],
      dynamic: [],
    };
    const input = await buildPromptLlmInputFromLayout(layout, {
      workplaceDisplay: "WT-BODY",
      messages: [],
      now: fixedNow,
    });
    assert.deepEqual(
      input.messages.map((m) => m.id),
      ["prompt:workplace", "prompt:workplace:done"],
    );
    assert.equal(input.messages[1]!.role, "assistant");
  });

  it("T-W5b: 预览 segment id 为 prompt-workplace / prompt-workplace-done", async () => {
    const layout: AgentPromptLayout = {
      workplace: true,
      persistEnabled: false,
      persist: [],
      dynamic: [],
    };
    const segments = await buildPromptAssemblyFromLayout(layout, {
      workplaceDisplay: "WT",
      messages: [],
      now: fixedNow,
    });
    const wt = segments.find((s) => s.id === "prompt-workplace");
    const done = segments.find((s) => s.id === "prompt-workplace-done");
    assert.equal(wt?.role, "user");
    assert.equal(wt?.body, "WT");
    assert.equal(done?.role, "assistant");
    assert.equal(done?.body, TOOL_TURN_BRIDGE_TEXT);
  });

  it("T-W6: 写出 wire 无 type:worktree", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "writer",
        prompts: {
          workplace: true,
          persist: {
            intro: { type: "text", role: "user", content: "a" },
            canon: { type: "worktree" },
          },
          dynamic: {},
        },
      },
      agentDefinitionSchema,
    );
    const wire = encode(def, agentDefinitionSchema) as {
      prompts: { persist: Record<string, { type: string }>; workplace?: boolean };
    };
    assert.equal(wire.prompts.workplace, true);
    assert.equal(Object.keys(wire.prompts.persist).length, 1);
    assert.ok(
      Object.values(wire.prompts.persist).every((b) => b.type === "text"),
    );
  });

  it("T-W9: resolveAgentDefinitionFromStorage 域形态 strip worktree", async () => {
    const stored = {
      name: "domain",
      prompts: {
        persist: [{ name: "canon", type: "worktree" as const, role: "user" as const }],
        dynamic: [],
      },
    };
    const health = resolveAgentDefinitionFromStorage(stored);
    assert.equal(health.status, "valid");
    if (health.status !== "valid") {
      return;
    }
    assert.equal(health.value.prompts.workplace, undefined);
    assert.deepEqual(health.value.prompts.persist, []);

    const input = await buildPromptLlmInputFromLayout(health.value.prompts, {
      workplaceDisplay: "WT",
      messages: [],
      now: fixedNow,
    });
    assert.equal(input.messages.length, 0);

    const segments = await buildPromptAssemblyFromLayout(health.value.prompts, {
      workplaceDisplay: "WT",
      messages: [],
      now: fixedNow,
    });
    assert.ok(segments.every((s) => !s.id.startsWith("prompt-workplace")));
  });
});
