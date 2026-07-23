/**
 * annotate-workplace-ux-fix：常驻工作区 schema / wire（T-WP1–T-WP3）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode, ConfigDecodeError } from "@novel-master/core";
import { agentDefinitionSchema } from "@novel-master/core/agent";
import {
  DEFAULT_WORKPLACE_ASSISTANT_TEXT,
  WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT,
  PromptError,
} from "@novel-master/core/prompt";
import { validateAgentPromptLayoutFromMaps } from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";

const emptyPrompts = { persist: {}, dynamic: {} };

describe("workplace schema / wire（T-WP1–T-WP3）", () => {
  it("T-WP1: decode workplace:true → 域开启且文案【done】", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "compat",
        prompts: { ...emptyPrompts, workplace: true },
      },
      agentDefinitionSchema,
    );
    assert.equal(def.prompts.workplace, WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT);
    assert.equal(def.prompts.workplace, "【done】");
  });

  it('T-WP2: decode workplace:"i have seen workplace" → 原文案；toWire 写 string', () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "custom",
        prompts: {
          ...emptyPrompts,
          workplace: DEFAULT_WORKPLACE_ASSISTANT_TEXT,
        },
      },
      agentDefinitionSchema,
    );
    assert.equal(def.prompts.workplace, DEFAULT_WORKPLACE_ASSISTANT_TEXT);
    const wire = encode(def, agentDefinitionSchema) as {
      prompts: { workplace?: boolean | string };
    };
    assert.equal(wire.prompts.workplace, DEFAULT_WORKPLACE_ASSISTANT_TEXT);
    assert.equal(typeof wire.prompts.workplace, "string");
  });

  it('T-WP3: workplace:"" 或仅空白 → 校验失败', () => {
    assert.throws(
      () =>
        decode(
          {
            schemaVersion: 1,
            name: "empty",
            prompts: { ...emptyPrompts, workplace: "" },
          },
          agentDefinitionSchema,
        ),
      (e: unknown) =>
        e instanceof ConfigDecodeError && /workplace/.test(e.message),
    );
    assert.throws(
      () =>
        validateAgentPromptLayoutFromMaps({}, {}, undefined, {
          workplace: "   ",
        }),
      (e: unknown) =>
        e instanceof PromptError && /workplace/.test((e as Error).message),
    );
  });
});
