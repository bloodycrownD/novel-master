/**
 * tools 段折算进本地 prompt 计数的单测。
 *
 * 背景：API 的 `prompt_tokens` 含 tools 定义，本地估算早先不数 tools —— 两个
 * 口径可比性差。本测试钉住三件事：
 * 1. `serializeToolsForTokenCount` 的序列化形状（空 → 空串；只取三字段、键序稳定）；
 * 2. heuristic-only 路径（core）与注册驱动路径（node driver）都把 tools 段拼进
 *    同一个序列化串（用「跑一遍真实序列化 + 手算期望值」对齐，而非只断言变大）；
 * 3. 空数组与 undefined 结果一致（不引入无意义差异）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../../helpers/register-node-tokenizer-driver-for-tests.js";
import type { LlmToolDefinition } from "../../../src/infra/llm-protocol/ports/adapter.port.js";
import {
  countPromptLlmInput,
  countPromptLlmInputHeuristicOnly,
  createDefaultTokenCounterRegistry,
  serializePromptLlmInput,
  serializeToolsForTokenCount,
} from "../../../src/infra/tokenizer/index.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

const TOOLS: readonly LlmToolDefinition[] = [
  {
    name: "read_file",
    description: "读取工作区里的一个文件并返回正文。",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "把正文写入工作区文件。",
    inputSchema: { type: "object", properties: { path: {}, content: {} } },
  },
];

const BASE_PARAMS = {
  layout: { persist: [], dynamic: [] },
  ctx: { workplaceDisplay: "", messages: [] },
  savedModelId: "openai/gpt-4o",
} as const;

describe("serializeToolsForTokenCount", () => {
  it("空数组 / undefined → 空串（拼接即恒等）", () => {
    assert.equal(serializeToolsForTokenCount(undefined), "");
    assert.equal(serializeToolsForTokenCount([]), "");
    assert.equal("prompt".concat(serializeToolsForTokenCount([])), "prompt");
  });

  it("非空 → 前导换行 + 只含 name/description/inputSchema 的稳定 JSON", () => {
    const extra = {
      ...TOOLS[0],
      // 多余字段（如 registry 内部标记）不得进序列化串
      internalFlag: true,
    } as unknown as LlmToolDefinition;
    const text = serializeToolsForTokenCount([extra]);
    assert.ok(text.startsWith("\n"));
    assert.deepEqual(JSON.parse(text.slice(1)), [
      {
        name: "read_file",
        description: "读取工作区里的一个文件并返回正文。",
        inputSchema: TOOLS[0].inputSchema,
      },
    ]);
    // 同输入同输出（稳定序列化）
    assert.equal(text, serializeToolsForTokenCount([TOOLS[0]]));
  });
});

describe("本地计数含 tools 段", () => {
  const registry = createDefaultTokenCounterRegistry(emptyRegistryDeps());

  it("heuristic-only：带 tools 比不带大；空数组与不带一致", async () => {
    const without = await countPromptLlmInputHeuristicOnly({
      ...BASE_PARAMS,
      registry,
    });
    const withTools = await countPromptLlmInputHeuristicOnly({
      ...BASE_PARAMS,
      registry,
      tools: TOOLS,
    });
    const withEmpty = await countPromptLlmInputHeuristicOnly({
      ...BASE_PARAMS,
      registry,
      tools: [],
    });

    assert.equal(withTools.counterKind, "heuristic");
    assert.equal(withTools.estimated, true);
    assert.ok(
      withTools.tokenCount > without.tokenCount,
      `带 tools 应更大（without=${without.tokenCount}, with=${withTools.tokenCount}）`
    );
    assert.equal(withEmpty.tokenCount, without.tokenCount);
  });

  it("注册驱动路径（node driver，heuristic 档）：tools 文本按同一序列化拼接", async () => {
    registerNodeTokenizerDriverForTests();

    const without = await countPromptLlmInput({
      ...BASE_PARAMS,
      registry,
      tokenizerOverride: "heuristic",
    });
    const withTools = await countPromptLlmInput({
      ...BASE_PARAMS,
      registry,
      tokenizerOverride: "heuristic",
      tools: TOOLS,
    });

    const serialized = await serializePromptLlmInput(
      BASE_PARAMS.layout,
      BASE_PARAMS.ctx
    );
    const expected = registry.heuristic.countText(
      serialized + serializeToolsForTokenCount(TOOLS)
    );
    assert.equal(withTools.tokenCount, expected);
    assert.ok(withTools.tokenCount > without.tokenCount);
  });
});
