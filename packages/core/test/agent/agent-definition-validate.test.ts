import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decode } from "@novel-master/core";

import {
  agentDefinitionSchema,
  validateAgentDefinition,
  AgentConfigError,
} from "@novel-master/core/agent";
import type {
  AgentConfigErrorCode,
  AgentDefinition,
  ValidateAgentDefinitionOptions,
} from "@novel-master/core/agent";

const TEST_SAVED_MODEL = "11111111-1111-4111-8111-111111111111";
const TEST_SAVED_MODEL_GHOST = "22222222-2222-4222-8222-222222222222";

async function expectInvalid(def: AgentDefinition, code: AgentConfigErrorCode, messageRe: RegExp, options?: ValidateAgentDefinitionOptions): Promise<void> {
  const result = await validateAgentDefinition(def, options);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(result.error instanceof AgentConfigError);
  assert.equal(result.error.code, code);
  assert.match(result.error.message, messageRe);
}

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
    const result = await validateAgentDefinition(def, {
      assertSavedModel: async (savedModelId) => {
        seen = savedModelId;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(seen, TEST_SAVED_MODEL);
  });

  it("D2: assertSavedModel failure returns INVALID_MODEL for unknown pin", async () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "pinned",
        prompts: { persist: {}, dynamic: {} },
        model: TEST_SAVED_MODEL_GHOST,
      },
      agentDefinitionSchema,
    );
    await expectInvalid(
      def,
      "INVALID_MODEL",
      new RegExp(`unknown model: ${TEST_SAVED_MODEL_GHOST}`),
      {
        assertSavedModel: async () => {
          throw new Error(`unknown model: ${TEST_SAVED_MODEL_GHOST}`);
        },
      },
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
    const result = await validateAgentDefinition(def, {
      assertSavedModel: async () => {
        called = true;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(called, false);
  });
});

describe("validateAgentDefinition 写入门禁（毒行拦截）", () => {
  /** 直接构造宽松收包形态（不经过 schema decode），模拟 agent 工具收到的 LLM 原始 JSON。 */
  function rawDef(extra: Record<string, unknown>): AgentDefinition {
    return {
      prompts: { persist: [], dynamic: [] },
      ...extra,
    } as unknown as AgentDefinition;
  }

  it("name 缺失：报 INVALID_SCHEMA 且文案指向 definition.name（不再是裸 TypeError）", async () => {
    await expectInvalid(rawDef({}), "INVALID_SCHEMA", /definition\.name 必填/);
  });

  it("name 空白串 / 非字符串：同样拒绝", async () => {
    await expectInvalid(rawDef({ name: "   " }), "INVALID_SCHEMA", /definition\.name 必填/);
    await expectInvalid(rawDef({ name: 123 }), "INVALID_SCHEMA", /definition\.name 必填/);
  });

  it("prompts 缺失：报 INVALID_SCHEMA 且文案说明必填", async () => {
    // 分层：registry.upsert 会先补默认空布局再调本函数，此守卫仅拦截
    // 绕过 registry 的直接调用方（public API / project.service 均自带完整 def）。
    await expectInvalid({ name: "x" } as unknown as AgentDefinition, "INVALID_SCHEMA", /definition\.prompts 必填/);
  });

  it("prompts 为 wire 格式（dynamic/persist 是对象映射而非块数组）：拒绝并提示对齐 get 输出", async () => {
    await expectInvalid(
      rawDef({
        name: "x",
        prompts: {
          dynamicEnabled: true,
          persist: {},
          dynamic: {
            "dynamic-1": {
              type: "text",
              role: "assistant",
              content: " hi ",
            },
          },
        },
      }),
      "INVALID_SCHEMA",
      /块数组/,
    );
  });

  it("mode 非法枚举（toWire 原样透传、读侧 strict 拒收的真毒化向量）：wire 往返拒绝", async () => {
    await expectInvalid(rawDef({ name: "x", mode: "custommode" }), "INVALID_SCHEMA", /definition 字段不合法/);
  });

  it("未知顶层键（LLM 自创字段）：toWire 投影丢弃，不毒化、不拒绝", async () => {
    // 不报错即通过：definitionToDocument 只投影已知字段，自创键落盘前被洗掉。
    const result = await validateAgentDefinition(rawDef({ name: "x", persona: "y" }));
    assert.equal(result.ok, true);
  });

  it("model 非 UUID：wire 往返拒绝", async () => {
    await expectInvalid(rawDef({ name: "x", model: "gpt-4" }), "INVALID_SCHEMA", /definition 字段不合法/);
  });

  it("真实场景 payload（system/workplace/customAttach/dynamic 块/runtime）补 name 后通过", async () => {
    const def = rawDef({
      name: "执笔者",
      description: "文笔顶尖的执笔者",
      mode: "subagent",
      runtime: { maxSteps: 20 },
      prompts: {
        system: "## 你是谁\\n\\n你是专职执笔者。",
        workplace: "我看到工作区了",
        customAttach: "当前工作区如下：\\n{{$filetree}}",
        dynamicEnabled: true,
        persist: [],
        dynamic: [
          {
            name: "dynamic-1",
            type: "text",
            role: "assistant",
            content: "请问还有什么要补充的吗？",
          },
          {
            name: "dynamic-2",
            type: "text",
            role: "user",
            content: "没有了，按照我的命令执行就好了。",
          },
        ],
      },
    });
    const result = await validateAgentDefinition(def);
    assert.equal(result.ok, true);
  });
});
