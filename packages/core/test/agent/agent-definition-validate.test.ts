import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";

import { agentDefinitionSchema, validateAgentDefinition } from "@novel-master/core/agent";

const TEST_SAVED_MODEL = "11111111-1111-4111-8111-111111111111";
const TEST_SAVED_MODEL_GHOST = "22222222-2222-4222-8222-222222222222";

describe("validateAgentDefinition", () => {
  it("D2: assertSavedModel runs for valid model pin", async () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "pinned",
        prompts: { persist: {}, dynamic: {} },
        model: TEST_SAVED_MODEL,
      },
      agentDefinitionSchema,
    );
    let seen = "";
    await validateAgentDefinition(def, {
      assertSavedModel: async (savedModelId) => {
        seen = savedModelId;
      },
    });
    assert.equal(seen, TEST_SAVED_MODEL);
  });

  it("D2: assertSavedModel failure rejects unknown pin", async () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "pinned",
        prompts: { persist: {}, dynamic: {} },
        model: TEST_SAVED_MODEL_GHOST,
      },
      agentDefinitionSchema,
    );
    await assert.rejects(
      () =>
        validateAgentDefinition(def, {
          assertSavedModel: async () => {
            throw new Error(`unknown model: ${TEST_SAVED_MODEL_GHOST}`);
          },
        }),
      new RegExp(`unknown model: ${TEST_SAVED_MODEL_GHOST}`),
    );
  });

  it("skips assertSavedModel when model absent", async () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "bare",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    );
    let called = false;
    await validateAgentDefinition(def, {
      assertSavedModel: async () => {
        called = true;
      },
    });
    assert.equal(called, false);
  });
});
