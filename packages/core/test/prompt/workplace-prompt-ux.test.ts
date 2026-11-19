/**
 * annotate-workplace-ux-fix：常驻工作区 schema / 注入（T-WP1–T-WP6）。
 */
import { outcomeValue } from "../helpers/outcome-value.js";
import { unwrap } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Result } from "../../src/errors/either.js";
import { decode as decodeRaw, encode } from "@novel-master/core";
import type { ZodType } from "zod";

/** decode 已改返回 Result（四期签名）：测试内统一解包——Ok 取 value，Err 抛 error。 */
function decode<T>(raw: unknown, schema: ZodType<T>): T {
  return unwrap(decodeRaw(raw, schema));
}
import { isAppError } from "@novel-master/core/errors";
import { agentDefinitionSchema } from "@novel-master/core/agent";
import { DEFAULT_WORKPLACE_ASSISTANT_TEXT, WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT, PromptBuilder, MessageBodyText } from "@novel-master/core/prompt";
import { assembleWorkplaceDisplay, WorkplaceDisplay } from "@novel-master/core/workplace";
import { AgentPromptLayoutValidate } from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import { createMemorySessionKkv, mockWorkplaceService } from "../helpers/prompt-layout-test-helpers.js";
import { tCore } from "../helpers/core-i18n.js";

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


/** Outcome 收窄：本文件用例只关心 completed 分支（中止语义在 abort-fingerprint 套件）。 */
async function assembleDisplay(...args: Parameters<typeof assembleWorkplaceDisplay>) {
  return outcomeValue(await assembleWorkplaceDisplay(...args));
}

describe("workplace schema / wire（T-WP1–T-WP3）", () => {
  it("T-WP1: decode workplace:true → 域开启且文案【done】", () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "compat",
        prompts: { ...emptyPrompts, workplace: true },
      },
      agentDefinitionSchema
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
      agentDefinitionSchema
    );
    assert.equal(def.prompts.workplace, DEFAULT_WORKPLACE_ASSISTANT_TEXT);
    // encode 已改返回 Result（五期签名）：unwrap 解包后取 wire。
    const wire = unwrap(encode(def, agentDefinitionSchema)) as {
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
          agentDefinitionSchema
        ),
      // 空白 workplace 的拒绝统一收进布局校验（PROMPT_INVALID_LAYOUT），与后半段
      // AgentPromptLayoutValidate.validateFromMaps 的断言同一条通道（五期 schema 收敛）。
      (e: unknown) => isAppError(e, "PROMPT_INVALID_LAYOUT")
    );
    const blank = AgentPromptLayoutValidate.validateFromMaps({}, {}, undefined, {
      workplace: "   ",
    });
    assert.ok(!blank.ok);
    assert.match(
      blank.error.messageKey != null
        ? tCore({ key: blank.error.messageKey, params: blank.error.messageParams })
        : blank.error.message,
      /workplace/
    );
  });
});

describe("workplace assemble / render（T-WP4–T-WP5）", () => {
  it("T-WP4: render 路径 user body 恰好一层 <workplace>；renderFileBlock 本身不包", async () => {
    const file = WorkplaceDisplay.renderFileBlock({
      logicalPath: "/a.md",
      mtimeMs: 1,
      display: "full",
      content: "hello",
    });
    const inner = WorkplaceDisplay.joinFileBlocks([file]);
    assert.ok(inner.includes("<file "));
    assert.equal(inner.includes("<workplace>"), false);

    const layout: AgentPromptLayout = {
      workplace: DEFAULT_WORKPLACE_ASSISTANT_TEXT,
      persist: [],
      dynamic: [],
    };
    const wrapped = `<workplace>\n${inner}\n</workplace>`;
    const input = unwrap(await PromptBuilder.llmInput(layout, {
      workplaceDisplay: wrapped,
      messages: [],
      now: fixedNow,
    }));
    const userBody = MessageBodyText.fromBlocks(input.messages[0]!.content.blocks);
    assert.equal(countTag(userBody, "<workplace>"), 1);
    assert.equal(countTag(userBody, "</workplace>"), 1);
    assert.ok(userBody.includes("<file "));
    assert.equal(userBody.includes("<<workplace>"), false);
    assert.equal(userBody.includes("<workplace>\n<workplace>"), false);

    const emptyOut = await assembleDisplay(
      { kind: "session", projectId: "p", sessionId: "s" },
      {
        sessionKkv: createMemorySessionKkv(),
        // evaluateRuleView port 已改返回 Result<WorkplaceRuleView, AppError>，内联 mock 同形
        workplace: {
          scope: { kind: "session", projectId: "p", sessionId: "s" },
          evaluateRuleView: async () => Result.ok({rows: [], displayByPath: new Map()}),
        } as never,
        vfs: { read: async () => Result.ok({ content: "x", mtimeMs: 1 }) } as never,
        layout,
      }
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
    const input = unwrap(await PromptBuilder.llmInput(layout, {
      workplaceDisplay: "<workplace>\n<body/>\n</workplace>",
      messages: [],
      now: fixedNow,
    }));
    assert.equal(input.messages[1]!.id, "prompt:workplace:done");
    assert.equal(MessageBodyText.fromBlocks(input.messages[1]!.content.blocks), custom);
    assert.notEqual(MessageBodyText.fromBlocks(input.messages[1]!.content.blocks), "【done】");

    const segments = unwrap(await PromptBuilder.assemble(layout, {
      workplaceDisplay: "<workplace>\n<body/>\n</workplace>",
      messages: [],
      now: fixedNow,
    }));
    const done = segments.find((s) => s.id === "prompt-workplace-done");
    assert.equal(done?.body, custom);
  });

  it("T-WP5b: 历史桥文案【done】与常驻文案解耦（桥机制已移除）", () => {
    assert.notEqual(DEFAULT_WORKPLACE_ASSISTANT_TEXT, "【done】");
  });
});
