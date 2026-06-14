import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptLlmInputFromLayout,
  messageBodyText,
  type AgentPromptLayout,
} from "@novel-master/core";

const ctx = {
  worktreeDisplay: "",
  messages: [],
};

describe("buildPromptLlmInputFromLayout lifecycle", () => {
  const layout: AgentPromptLayout = {
    dynamicEnabled: true,
    persist: [],
    dynamic: [
      { name: "kick", type: "text", role: "user", content: "go", lifecycle: "once" },
    ],
  };

  it("once block included at step 0 only", async () => {
    const step0 = await buildPromptLlmInputFromLayout(layout, ctx, { agentStepIndex: 0 });
    assert.equal(step0.messages.length, 1);
    assert.equal(step0.messages[0]!.id, "prompt:kick");

    const step1 = await buildPromptLlmInputFromLayout(layout, ctx, { agentStepIndex: 1 });
    assert.equal(step1.messages.length, 0);
  });

  it("always block included on every step", async () => {
    const alwaysLayout: AgentPromptLayout = {
      dynamicEnabled: true,
      persist: [],
      dynamic: [
        { name: "ctx", type: "text", role: "user", content: "prefix" },
      ],
    };
    for (const step of [0, 1, 2]) {
      const input = await buildPromptLlmInputFromLayout(alwaysLayout, ctx, {
        agentStepIndex: step,
      });
      assert.equal(input.messages.length, 1);
    }
  });

  it("defaults agentStepIndex to 0", async () => {
    const explicit = await buildPromptLlmInputFromLayout(layout, ctx, { agentStepIndex: 0 });
    const implicit = await buildPromptLlmInputFromLayout(layout, ctx);
    assert.equal(explicit.messages.length, implicit.messages.length);
  });

  it("system field unaffected by dynamic lifecycle", async () => {
    const systemLayout: AgentPromptLayout = {
      system: "sys",
      dynamicEnabled: true,
      persist: [],
      dynamic: [
        { name: "kick", type: "text", role: "user", content: "x", lifecycle: "once" },
      ],
    };
    const step1 = await buildPromptLlmInputFromLayout(systemLayout, ctx, {
      agentStepIndex: 1,
    });
    assert.equal(step1.system, "sys");
    assert.equal(step1.messages.length, 0);
  });

  it("dynamicEnabled=false 时 lifecycle 块不出现", async () => {
    const disabledLayout: AgentPromptLayout = {
      dynamicEnabled: false,
      persist: [],
      dynamic: [
        { name: "kick", type: "text", role: "user", content: "go", lifecycle: "once" },
      ],
    };
    const step0 = await buildPromptLlmInputFromLayout(disabledLayout, ctx, {
      agentStepIndex: 0,
    });
    assert.equal(step0.messages.length, 0);
  });
});
