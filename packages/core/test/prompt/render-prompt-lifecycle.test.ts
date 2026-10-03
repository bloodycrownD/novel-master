import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
  computeLlmExportZonesFromLayout,
  type AgentPromptLayout,
} from "@novel-master/core/prompt";

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

// r1r3/G-1：zones 与 assembly 两处 lifecycle 判定的 step≥1 负向覆盖。
// 这两处判定若被改成恒真，以下两条用例必须同时变红（normalizeForLlmExport
// 每 step 依赖 zones.dynamicCount 切导出切片，回归即静默错切）。
describe("computeLlmExportZonesFromLayout lifecycle（dynamic 一律 once 语义）", () => {
  const zonesLayout: AgentPromptLayout = {
    dynamicEnabled: true,
    persist: [],
    dynamic: [
      { name: "kick", type: "text", role: "user", content: "go" },
      { name: "tail", type: "text", role: "assistant", content: "bye" },
    ],
  };

  it("dynamicCount 仅在 step 0 非零，step≥1 归零", () => {
    assert.equal(
      computeLlmExportZonesFromLayout(zonesLayout, { agentStepIndex: 0 }).dynamicCount,
      2
    );
    for (const step of [1, 2]) {
      assert.equal(
        computeLlmExportZonesFromLayout(zonesLayout, { agentStepIndex: step })
          .dynamicCount,
        0
      );
    }
  });
});

describe("buildPromptAssemblyFromLayout lifecycle（dynamic 一律 once 语义）", () => {
  const assemblyLayout: AgentPromptLayout = {
    dynamicEnabled: true,
    persist: [],
    dynamic: [
      { name: "kick", type: "text", role: "user", content: "go" },
      { name: "tail", type: "text", role: "assistant", content: "bye" },
    ],
  };

  it("step 0 产出 dynamic-* 段，step≥1 不产出任何 dynamic- 段", async () => {
    const step0 = await buildPromptAssemblyFromLayout(assemblyLayout, ctx, {
      agentStepIndex: 0,
    });
    assert.deepEqual(
      step0
        .filter((segment) => segment.id.startsWith("dynamic-"))
        .map((segment) => segment.id),
      ["dynamic-kick", "dynamic-tail"]
    );

    for (const step of [1, 2]) {
      const segments = await buildPromptAssemblyFromLayout(assemblyLayout, ctx, {
        agentStepIndex: step,
      });
      assert.deepEqual(
        segments.filter((segment) => segment.id.startsWith("dynamic-")).map(
          (segment) => segment.id
        ),
        []
      );
    }
  });
});
