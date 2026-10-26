import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppError } from "../../src/errors/app-error.js";
import type { Result } from "../../src/errors/either.js";
import { agentDefinitionSchema } from "../../src/domain/agent/model/agent-definition.schema.js";
import { validateAgentPromptLayoutFromMaps } from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";

type LayoutErrorKey = "PROMPT_INVALID_LAYOUT" | "PROMPT_INVALID_MACRO";

function expectOk<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    assert.fail(result.error instanceof Error ? result.error.message : String(result.error));
  }
  return result.value;
}

function expectError(result: Result<unknown, unknown>, key: LayoutErrorKey, pattern: RegExp): void {
  if (result.ok) {
    assert.fail("预期校验失败，实际成功");
  }
  assert.ok(isAppError(result.error, key), `期望 ${key}，实际 ${String(result.error)}`);
  assert.match(result.error.message, pattern);
}

describe("validateAgentPromptLayoutFromMaps", () => {
  it("拒绝 persist 文本含宏", () => {
    expectError(validateAgentPromptLayoutFromMaps({ bad: { type: "text", role: "user", content: "x {{$time}}" } }, {}), "PROMPT_INVALID_MACRO", /持久区文本块不得包含宏/);
  });

  it("persist lifecycle 静默剥键后正常解析（与 zod 层同款 strip 语义）", () => {
    const layout = expectOk(
      validateAgentPromptLayoutFromMaps(
        {
          ok: {
            type: "text",
            role: "user",
            content: "x",
            lifecycle: "once",
          },
        },
        {}
      )
    );
    assert.deepEqual(layout.persist, [{ name: "ok", type: "text", role: "user", content: "x" }]);
  });

  it("dynamic lifecycle（once / always / 非法值 / null）静默剥键", () => {
    for (const lifecycle of ["once", "always", "foo", null]) {
      const layout = expectOk(
        validateAgentPromptLayoutFromMaps(
          {},
          {
            d: { type: "text", role: "user", content: "x", lifecycle },
          }
        )
      );
      assert.deepEqual(layout.dynamic, [{ name: "d", type: "text", role: "user", content: "x" }]);
    }
  });

  it("拒绝 persist system role", () => {
    expectError(validateAgentPromptLayoutFromMaps({ bad: { type: "text", role: "system", content: "x" } }, {}), "PROMPT_INVALID_LAYOUT", /prompts\.system/);
  });

  it("拒绝 dynamic {{.filetree}}", () => {
    expectError(validateAgentPromptLayoutFromMaps({}, { bad: { type: "text", role: "user", content: "{{.filetree}}" } }), "PROMPT_INVALID_MACRO", /\$filetree/);
  });

  it("接受 dynamic {{$filetree}}", () => {
    const layout = expectOk(validateAgentPromptLayoutFromMaps({}, { state: { type: "text", role: "user", content: "{{$filetree}}" } }));
    assert.equal(layout.dynamic.length, 1);
  });

  it("strip persist 旧 worktree 块（不升迁 workplace）", () => {
    const layout = expectOk(validateAgentPromptLayoutFromMaps({ canon: { type: "worktree" } }, {}));
    assert.equal(layout.persist.length, 0);
    assert.equal(layout.workplace, undefined);
  });

  it("T-WT1: persist 开：文本末块非 assistant 失败", () => {
    expectError(validateAgentPromptLayoutFromMaps({ tail: { type: "text", role: "user", content: "x" } }, {}, undefined, { persistEnabled: true }), "PROMPT_INVALID_LAYOUT", /最后一个块须为助手/);
  });

  it("T-WT2: persist 开：文本末块 assistant 通过", () => {
    const layout = expectOk(
      validateAgentPromptLayoutFromMaps(
        {
          head: { type: "text", role: "user", content: "x" },
          tail: { type: "text", role: "assistant", content: "ok" },
        },
        {},
        undefined,
        { persistEnabled: true }
      )
    );
    assert.equal(layout.persist.length, 2);
    assert.equal(layout.persist[1]?.role, "assistant");
  });

  it("T-WT3: persist 开：无文本块失败", () => {
    expectError(validateAgentPromptLayoutFromMaps({ canon: { type: "worktree" } }, {}, undefined, { persistEnabled: true }), "PROMPT_INVALID_LAYOUT", /至少需要一个文本块/);
  });

  it("persist 开：末块非 assistant 失败", () => {
    expectError(validateAgentPromptLayoutFromMaps({ tail: { type: "text", role: "user", content: "x" } }, {}, undefined, { persistEnabled: true }), "PROMPT_INVALID_LAYOUT", /最后一个块须为助手/);
  });

  it("dynamic 开：仅 1 块失败", () => {
    expectError(validateAgentPromptLayoutFromMaps({}, { only: { type: "text", role: "assistant", content: "x" } }, undefined, { dynamicEnabled: true }), "PROMPT_INVALID_LAYOUT", /至少需要两个块/);
  });

  it("dynamic 开：首非 assistant 失败", () => {
    expectError(
      validateAgentPromptLayoutFromMaps(
        {},
        {
          a: { type: "text", role: "user", content: "x" },
          b: { type: "text", role: "user", content: "y" },
        },
        undefined,
        { dynamicEnabled: true }
      ),
      "PROMPT_INVALID_LAYOUT",
      /第一个块须为助手/
    );
  });

  it("dynamic 开：末非 user 失败", () => {
    expectError(
      validateAgentPromptLayoutFromMaps(
        {},
        {
          a: { type: "text", role: "assistant", content: "x" },
          b: { type: "text", role: "assistant", content: "y" },
        },
        undefined,
        { dynamicEnabled: true }
      ),
      "PROMPT_INVALID_LAYOUT",
      /最后一个块须为用户/
    );
  });

  it("开关关时不校验末块", () => {
    const layout = expectOk(validateAgentPromptLayoutFromMaps({ tail: { type: "text", role: "user", content: "x" } }, { only: { type: "text", role: "assistant", content: "y" } }));
    assert.equal(layout.persist.length, 1);
    assert.equal(layout.dynamic.length, 1);
  });

  it("T-CA3a: customAttach 含合法宏 {{$time}}/{{$filetree}} 通过且原样进 layout", () => {
    const layout = expectOk(validateAgentPromptLayoutFromMaps({}, {}, undefined, { customAttach: "现在是 {{$time}}，目录：{{$filetree}}" }));
    assert.equal(layout.customAttach, "现在是 {{$time}}，目录：{{$filetree}}");
  });

  it("T-CA3b: customAttach 含非法宏 {{$unknown}} 返回 PROMPT_INVALID_MACRO", () => {
    expectError(validateAgentPromptLayoutFromMaps({}, {}, undefined, { customAttach: "未知 {{$unknown}}" }), "PROMPT_INVALID_MACRO", /未知的动态宏/);
  });

  it("T-CA3c: 空 / 纯空白 customAttach 不出现在 layout", () => {
    const empty = expectOk(validateAgentPromptLayoutFromMaps({}, {}, undefined, { customAttach: "" }));
    assert.equal(empty.customAttach, undefined);
    const blank = expectOk(validateAgentPromptLayoutFromMaps({}, {}, undefined, { customAttach: "   \n  " }));
    assert.equal(blank.customAttach, undefined);
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
      (e: unknown) => isAppError(e, "AGENT_INVALID_SCHEMA") && e.message.includes("prompts.blocks is removed")
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
      (e: unknown) => isAppError(e, "AGENT_INVALID_SCHEMA") && e.message.includes("prompts.regions")
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
      (e: unknown) => isAppError(e, "AGENT_INVALID_SCHEMA") && e.message.includes("prompts.chat")
    );
  });
});
