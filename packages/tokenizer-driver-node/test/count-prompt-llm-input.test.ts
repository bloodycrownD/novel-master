import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
  resolveContextWindowTokens,
  type ChatMessage,
  type PromptLlmInput,
} from "@novel-master/core";
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

function fixtureInput(overrides?: Partial<PromptLlmInput>): PromptLlmInput {
  return {
    system: "You are helpful.",
    messages: [msg("user", "Hello")],
    ...overrides,
  };
}

describe("countPromptLlmInput", () => {
  before(() => {
    registerTokenizerNodeDriverForTests();
  });

  const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());

  it("C1: stable count for same input and model", async () => {
    const input = fixtureInput();
    const a = await countPromptLlmInput({
      input,
      applicationModelId: "openai/gpt-4o",
      registry,
    });
    const b = await countPromptLlmInput({
      input,
      applicationModelId: "openai/gpt-4o",
      registry,
    });
    assert.equal(a.tokenCount, b.tokenCount);
    assert.equal(a.counterKind, "tiktoken");
  });

  it("C2: larger system increases token count", async () => {
    const base = await countPromptLlmInput({
      input: fixtureInput(),
      applicationModelId: "openai/gpt-4o",
      registry,
    });
    const larger = await countPromptLlmInput({
      input: fixtureInput({ system: "You are helpful. ".repeat(20) }),
      applicationModelId: "openai/gpt-4o",
      registry,
    });
    assert.ok(larger.tokenCount > base.tokenCount);
  });

  it("claude model on openai provider uses claude family", async () => {
    const result = await countPromptLlmInput({
      input: fixtureInput(),
      applicationModelId: "openai/claude-3-5-sonnet",
      registry,
    });
    assert.equal(result.tokenizerFamily, "claude");
    assert.equal(result.counterKind, "claude");
    assert.ok(result.tokenCount > 0);
  });

  it("unknown model uses heuristic", async () => {
    const result = await countPromptLlmInput({
      input: fixtureInput(),
      applicationModelId: "openai/my-custom/foo",
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
