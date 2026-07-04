import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { type ChatMessage } from "@novel-master/core/chat";

import { type AgentPromptLayout, type PromptRenderContext } from "@novel-master/core/prompt";

import { countPromptLlmInput, createDefaultTokenCounterRegistry, resolveContextWindowTokens } from "@novel-master/core/provider";
import { registerTokenizerNodeDriverForTests } from "../src/register-for-tests.js";

function emptyRegistryDeps(): Record<string, never> {
  return {};
}

function msg(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: "1",
    sessionId: "s",
    seq: 1,
    role,
    content: { blocks: [{ type: "text", text }] },
    hidden: false,
    createdAtMs: 0,
  };
}

function fixtureParams(overrides?: {
  readonly systemContent?: string;
  readonly messages?: readonly ChatMessage[];
}): {
  readonly layout: AgentPromptLayout;
  readonly ctx: PromptRenderContext;
} {
  const systemContent = overrides?.systemContent ?? "You are helpful.";
  const messages = overrides?.messages ?? [msg("user", "Hello")];
  return {
    layout: {
      system: systemContent,
      persist: [],
      dynamic: [],
    },
    ctx: {
      worktreeDisplay: "",
      messages,
    },
  };
}

describe("countPromptLlmInput", () => {
  before(() => {
    registerTokenizerNodeDriverForTests();
  });

  const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());

  it("C1: stable count for same input and model", async () => {
    const { layout, ctx } = fixtureParams();
    const a = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/gpt-4o",
      registry,
    });
    const b = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.equal(a.tokenCount, b.tokenCount);
    assert.equal(a.counterKind, "tiktoken");
  });

  it("C2: larger system increases token count", async () => {
    const base = await countPromptLlmInput({
      ...fixtureParams(),
      savedModelId: "openai/gpt-4o",
      registry,
    });
    const larger = await countPromptLlmInput({
      ...fixtureParams({ systemContent: "You are helpful. ".repeat(20) }),
      savedModelId: "openai/gpt-4o",
      registry,
    });
    assert.ok(larger.tokenCount > base.tokenCount);
  });

  it("claude model on openai provider uses claude family", async () => {
    const result = await countPromptLlmInput({
      ...fixtureParams(),
      savedModelId: "openai/claude-3-5-sonnet",
      registry,
    });
    assert.equal(result.tokenizerFamily, "claude");
    assert.equal(result.counterKind, "claude");
    assert.ok(result.tokenCount > 0);
  });

  it("unknown model uses heuristic", async () => {
    const result = await countPromptLlmInput({
      ...fixtureParams(),
      savedModelId: "openai/my-custom/foo",
      registry,
    });
    assert.equal(result.tokenizerFamily, "heuristic");
    assert.equal(result.estimated, true);
  });
});

describe("resolveContextWindowTokens", () => {
  it("W1: claude-3-5-sonnet → 200000", () => {
    assert.equal(resolveContextWindowTokens("claude-3-5-sonnet"), 200_000);
  });
});
