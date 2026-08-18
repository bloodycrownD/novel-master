/**
 * 技能索引前缀语（prompts.skillsPrefix）渲染：
 * 自定义前缀替换默认行；缺省用 DEFAULT_SKILLS_INDEX_PREFIX。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SKILLS_INDEX_PREFIX,
  type AgentPromptLayout,
} from "../../src/domain/prompt/model/agent-prompt-layout.js";
import { buildPromptLlmInputFromLayout } from "../../src/service/prompt/render-prompt.js";
import type { PromptRenderContext } from "../../src/domain/prompt/model/prompt-render-context.js";

const ENTRIES = [
  { name: "demo", description: "演示", domain: "project" as const },
];

const BASE_LAYOUT: AgentPromptLayout = { persist: [], dynamic: [] };

function ctxWithSkills(): PromptRenderContext {
  return { messages: [], skillsIndex: ENTRIES } as PromptRenderContext;
}

function firstUserBody(input: { readonly messages: readonly { content: { blocks: readonly { type: string; text?: string }[] } }[] }): string {
  const block = input.messages[0]!.content.blocks[0]!;
  return block.type === "text" ? (block.text ?? "") : "";
}

describe("skillsPrefix 索引前缀语", () => {
  it("缺省：索引段以默认前缀开头", async () => {
    const input = await buildPromptLlmInputFromLayout(BASE_LAYOUT, ctxWithSkills());
    const body = firstUserBody(input);
    assert.ok(body.startsWith(DEFAULT_SKILLS_INDEX_PREFIX));
    assert.match(body, /- demo：演示（project）/);
  });

  it("自定义非空前缀替换默认行（trim 生效）", async () => {
    const layout: AgentPromptLayout = {
      ...BASE_LAYOUT,
      skillsPrefix: "  当前支持的 skill 如下：  ",
    };
    const input = await buildPromptLlmInputFromLayout(layout, ctxWithSkills());
    const body = firstUserBody(input);
    assert.ok(body.startsWith("当前支持的 skill 如下："));
    assert.equal(body.includes(DEFAULT_SKILLS_INDEX_PREFIX), false);
    assert.match(body, /- demo：演示（project）/);
  });

  it("skillsEnabled=false 时即便有 skillsIndex 也不注入（resolve 侧已摘工具，此处验渲染兼容）", async () => {
    const layout: AgentPromptLayout = { ...BASE_LAYOUT, skillsEnabled: false };
    const input = await buildPromptLlmInputFromLayout(layout, ctxWithSkills());
    assert.equal(input.messages.length, 0);
  });
});
