/**
 * annotate-workplace-ux-fix：常驻工作区 schema / 注入（T-WP1–T-WP6）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode, encode, ConfigDecodeError } from "@novel-master/core";
import { agentDefinitionSchema } from "@novel-master/core/agent";
import { TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";
import {
  DEFAULT_WORKPLACE_ASSISTANT_TEXT,
  WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT,
  buildPromptAssemblyFromLayout,
  buildPromptLlmInputFromLayout,
  messageBodyText,
  PromptError,
} from "@novel-master/core/prompt";
import {
  assembleWorkplaceDisplay,
  joinFileBlocks,
  renderFileBlock,
} from "@novel-master/core/workplace";
import { validateAgentPromptLayoutFromMaps } from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import {
  createMemorySessionKkv,
  mockWorkplaceService,
} from "../helpers/prompt-layout-test-helpers.js";

const fixedNow = new Date(2026, 4, 24, 9, 0, 0);
const emptyPrompts = { persist: {}, dynamic: {} };

function countTag(haystack: string, tag: string): number {
  let n = 0;
  let i = 0;
  while (true) {
    const at = haystack.indexOf(tag, i);
    if (at < 0) {
      return n;
    }
    n += 1;
    i = at + tag.length;
  }
}

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

describe("workplace assemble / render（T-WP4–T-WP5）", () => {
  it("T-WP4: render 路径 user body 恰好一层 <workplace>；renderFileBlock 本身不包", async () => {
    const file = renderFileBlock({
      logicalPath: "/a.md",
      mtimeMs: 1,
      display: "full",
      content: "hello",
    });
    const inner = joinFileBlocks([file]);
    assert.ok(inner.includes("<file "));
    assert.equal(inner.includes("<workplace>"), false);

    const layout: AgentPromptLayout = {
      workplace: DEFAULT_WORKPLACE_ASSISTANT_TEXT,
      persist: [],
      dynamic: [],
    };
    const wrapped = `<workplace>\n${inner}\n</workplace>`;
    const input = await buildPromptLlmInputFromLayout(layout, {
      workplaceDisplay: wrapped,
      messages: [],
      now: fixedNow,
    });
    const userBody = messageBodyText(input.messages[0]!);
    assert.equal(countTag(userBody, "<workplace>"), 1);
    assert.equal(countTag(userBody, "</workplace>"), 1);
    assert.ok(userBody.includes("<file "));
    assert.equal(userBody.includes("<<workplace>"), false);
    assert.equal(userBody.includes("<workplace>\n<workplace>"), false);

    const emptyOut = await assembleWorkplaceDisplay(
      { kind: "session", projectId: "p", sessionId: "s" },
      {
        sessionKkv: createMemorySessionKkv(),
        workplace: mockWorkplaceService(""),
        vfs: { read: async () => ({ content: "x", mtimeMs: 1 }) } as never,
        layout,
      },
    );
    assert.equal(emptyOut.workplaceDisplay, "");
  });

  it("T-WP5: assistant prompt:workplace:done 等于配置文案（非强制【done】）", async () => {
    const custom = "i have seen workplace";
    const layout: AgentPromptLayout = {
      workplace: custom,
      persist: [],
      dynamic: [],
    };
    const input = await buildPromptLlmInputFromLayout(layout, {
      workplaceDisplay: "<workplace>\n<body/>\n</workplace>",
      messages: [],
      now: fixedNow,
    });
    assert.equal(input.messages[1]!.id, "prompt:workplace:done");
    assert.equal(messageBodyText(input.messages[1]!), custom);
    assert.notEqual(messageBodyText(input.messages[1]!), TOOL_TURN_BRIDGE_TEXT);

    const segments = await buildPromptAssemblyFromLayout(layout, {
      workplaceDisplay: "<workplace>\n<body/>\n</workplace>",
      messages: [],
      now: fixedNow,
    });
    const done = segments.find((s) => s.id === "prompt-workplace-done");
    assert.equal(done?.body, custom);
  });

  it("T-WP5b: tool-turn bridge 仍为【done】（与常驻文案解耦）", () => {
    assert.equal(TOOL_TURN_BRIDGE_TEXT, "【done】");
  });
});
