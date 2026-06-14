import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentConfigError } from "../../src/errors/agent-config-errors.js";
import { agentDefinitionSchema } from "../../src/domain/agent/model/agent-definition.schema.js";
import { PromptError } from "../../src/errors/prompt-errors.js";
import {
  validateAgentPromptLayoutFromMaps,
} from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";

describe("validateAgentPromptLayoutFromMaps", () => {
  it("拒绝 persist 文本含宏", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          { bad: { type: "text", role: "user", content: "x {{$time}}" } },
          {},
        ),
      (e: unknown) =>
        e instanceof PromptError && e.message.includes("persist text blocks must not contain macros"),
    );
  });

  it("拒绝 persist lifecycle", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          {
            bad: {
              type: "text",
              role: "user",
              content: "x",
              lifecycle: "once",
            },
          },
          {},
        ),
      (e: unknown) => e instanceof PromptError && e.message.includes("persist text must not include lifecycle"),
    );
  });

  it("拒绝 persist system role", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          { bad: { type: "text", role: "system", content: "x" } },
          {},
        ),
      (e: unknown) => e instanceof PromptError && e.message.includes("prompts.system"),
    );
  });

  it("拒绝 dynamic {{.filetree}}", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          {},
          { bad: { type: "text", role: "user", content: "{{.filetree}}" } },
        ),
      (e: unknown) => e instanceof PromptError && e.message.includes("$filetree"),
    );
  });

  it("接受 dynamic {{$filetree}}", () => {
    const layout = validateAgentPromptLayoutFromMaps(
      {},
      { state: { type: "text", role: "user", content: "{{$filetree}}" } },
    );
    assert.equal(layout.dynamic.length, 1);
  });

  it("拒绝 persist 多个 worktree 块", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          { a: { type: "worktree" }, b: { type: "worktree" } },
          {},
        ),
      (e: unknown) => e instanceof PromptError && e.message.includes("at most one worktree"),
    );
  });

  it("worktree 缺省 role 时 normalize 为 user", () => {
    const layout = validateAgentPromptLayoutFromMaps(
      { canon: { type: "worktree" } },
      {},
    );
    assert.equal(layout.persist.length, 1);
    assert.equal(layout.persist[0]?.type, "worktree");
    assert.equal(
      layout.persist[0]?.type === "worktree" ? layout.persist[0].role : undefined,
      "user",
    );
  });

  it("接受 worktree role assistant", () => {
    const layout = validateAgentPromptLayoutFromMaps(
      { canon: { type: "worktree", role: "assistant" } },
      {},
    );
    assert.equal(
      layout.persist[0]?.type === "worktree" ? layout.persist[0].role : undefined,
      "assistant",
    );
  });

  it("拒绝 worktree 含 content", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          { canon: { type: "worktree", content: "x" } },
          {},
        ),
      (e: unknown) =>
        e instanceof PromptError && e.message.includes("worktree block must not include content"),
    );
  });

  it("拒绝 worktree 含 lifecycle", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          { canon: { type: "worktree", lifecycle: "once" } },
          {},
        ),
      (e: unknown) =>
        e instanceof PromptError && e.message.includes("worktree block must not include"),
    );
  });

  it("persist 开：末块非 assistant 失败", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          { tail: { type: "text", role: "user", content: "x" } },
          {},
          undefined,
          { persistEnabled: true },
        ),
      (e: unknown) =>
        e instanceof PromptError &&
        e.message.includes("last block must be assistant text"),
    );
  });

  it("dynamic 开：仅 1 块失败", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          {},
          { only: { type: "text", role: "assistant", content: "x" } },
          undefined,
          { dynamicEnabled: true },
        ),
      (e: unknown) =>
        e instanceof PromptError &&
        e.message.includes("at least two blocks"),
    );
  });

  it("dynamic 开：首非 assistant 失败", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          {},
          {
            a: { type: "text", role: "user", content: "x" },
            b: { type: "text", role: "user", content: "y" },
          },
          undefined,
          { dynamicEnabled: true },
        ),
      (e: unknown) =>
        e instanceof PromptError &&
        e.message.includes("first block must be assistant"),
    );
  });

  it("dynamic 开：末非 user 失败", () => {
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps(
          {},
          {
            a: { type: "text", role: "assistant", content: "x" },
            b: { type: "text", role: "assistant", content: "y" },
          },
          undefined,
          { dynamicEnabled: true },
        ),
      (e: unknown) =>
        e instanceof PromptError && e.message.includes("last block must be user"),
    );
  });

  it("开关关时不校验末块", () => {
    const layout = validateAgentPromptLayoutFromMaps(
      { tail: { type: "text", role: "user", content: "x" } },
      { only: { type: "text", role: "assistant", content: "y" } },
    );
    assert.equal(layout.persist.length, 1);
    assert.equal(layout.dynamic.length, 1);
  });
});

describe("agentDefinitionSchema wire", () => {
  it("拒绝 prompts.blocks", () => {
    assert.throws(
      () =>
        agentDefinitionSchema.parse({
          schemaVersion: 1,
          name: "a",
          prompts: { blocks: {} },
        }),
      (e: unknown) =>
        e instanceof AgentConfigError &&
        e.message.includes("prompts.blocks is removed"),
    );
  });

  it("拒绝 prompts.regions", () => {
    assert.throws(
      () =>
        agentDefinitionSchema.parse({
          schemaVersion: 1,
          name: "a",
          prompts: { regions: {} },
        }),
      (e: unknown) =>
        e instanceof AgentConfigError && e.message.includes("prompts.regions"),
    );
  });

  it("拒绝 prompts.chat", () => {
    assert.throws(
      () =>
        agentDefinitionSchema.parse({
          schemaVersion: 1,
          name: "a",
          prompts: { persist: {}, dynamic: {}, chat: {} },
        }),
      (e: unknown) =>
        e instanceof AgentConfigError && e.message.includes("prompts.chat"),
    );
  });
});
