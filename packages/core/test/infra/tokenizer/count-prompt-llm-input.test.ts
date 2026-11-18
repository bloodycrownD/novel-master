import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../../helpers/register-node-tokenizer-driver-for-tests.js";
import { AssertionError } from "../../../src/common/assert.js";
import {
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
  TokenizerRegistry,
} from "../../../src/infra/tokenizer/index.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

const minimalParams = {
  layout: { persist: [], dynamic: [] },
  ctx: { workplaceDisplay: "", messages: [] },
  savedModelId: "openai/gpt-4o",
  registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
} as const;

describe("countPromptLlmInput", () => {
  after(() => {
    registerNodeTokenizerDriverForTests();
  });

  it("throws AssertionError when no NMTP driver is registered", async () => {
    TokenizerRegistry.clear();
    await assert.rejects(
      () => countPromptLlmInput(minimalParams),
      (e) =>
        e instanceof AssertionError &&
        e.message.includes("Tokenizer: no driver registered") &&
        e.message.includes("registerTokenizerNodeDriver"),
    );
  });
});
