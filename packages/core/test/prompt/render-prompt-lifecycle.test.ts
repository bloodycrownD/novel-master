import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptLlmInputFromLayout, type AgentPromptLayout } from "@novel-master/core/prompt";

const ctx = {
  workplaceDisplay: "",
  messages: [],
};

describe("buildPromptLlmInputFromLayout lifecycle（dynamic 一律 once 语义）", () => {
  const layout: AgentPromptLayout = {
    dynamicEnabled: true,
    persist: [],
    dynamic: [{ name: "kick", type: "text", role: "user", content: "go" }],
  };

  it("dynamic 块仅在 step 0 注入", async () => {
    const step0 = await buildPromptLlmInputFromLayout(layout, ctx, { agentStepIndex: 0 });
    assert.equal(step0.messages.length, 1);
    assert.equal(step0.messages[0]!.id, "prompt:kick");

    const step1 = await buildPromptLlmInputFromLayout(layout, ctx, { agentStepIndex: 1 });
    assert.equal(step1.messages.length, 0);
  });

  it("无 lifecycle 字段的块同样只在 step 0 注入（旧 always 语义已下线）", async () => {
    const plainLayout: AgentPromptLayout = {
      dynamicEnabled: true,
      persist: [],
      dynamic: [{ name: "ctx", type: "text", role: "user", content: "prefix" }],
    };
    assert.equal(
      (await buildPromptLlmInputFromLayout(plainLayout, ctx, { agentStepIndex: 0 })).messages
        .length,
      1
    );
    for (const step of [1, 2]) {
      const input = await buildPromptLlmInputFromLayout(plainLayout, ctx, {
        agentStepIndex: step,
      });
      assert.equal(input.messages.length, 0);
    }
  });

  it("defaults agentStepIndex to 0", async () => {
    const explicit = await buildPromptLlmInputFromLayout(layout, ctx, { agentStepIndex: 0 });
    const implicit = await buildPromptLlmInputFromLayout(layout, ctx);
    assert.equal(explicit.messages.length, implicit.messages.length);
    assert.equal(implicit.messages.length, 1);
  });

  it("system field 不受 dynamic once 语义影响", async () => {
    const systemLayout: AgentPromptLayout = {
      system: "sys",
      dynamicEnabled: true,
      persist: [],
      dynamic: [{ name: "kick", type: "text", role: "user", content: "x" }],
    };
    const step1 = await buildPromptLlmInputFromLayout(systemLayout, ctx, {
      agentStepIndex: 1,
    });
    assert.equal(step1.system, "sys");
    assert.equal(step1.messages.length, 0);
  });

  it("dynamicEnabled=false 时 dynamic 块不出现", async () => {
    const disabledLayout: AgentPromptLayout = {
      dynamicEnabled: false,
      persist: [],
      dynamic: [{ name: "kick", type: "text", role: "user", content: "go" }],
    };
    const step0 = await buildPromptLlmInputFromLayout(disabledLayout, ctx, {
      agentStepIndex: 0,
    });
    assert.equal(step0.messages.length, 0);
  });
});
