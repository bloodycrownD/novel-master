/**
 * mergeAgentDefinitionPatch 单测：顶层浅合并 / null 清除 / prompts 子键合并。
 *
 * @module agent/merge-agent-definition-patch.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import { mergeAgentDefinitionPatch } from "@/domain/agent/logic/merge-agent-definition-patch.js";

function base(): AgentDefinition {
  return {
    name: "beta",
    description: "旧描述",
    model: "model-uuid-1",
    prompts: {
      persist: [{ name: "p1", content: "持久块" }],
      dynamic: [{ name: "d1", content: "动态块" }],
    },
  };
}

describe("mergeAgentDefinitionPatch", () => {
  it("顶层浅合并：只填要改的字段，其余保留现值", () => {
    const merged = mergeAgentDefinitionPatch(base(), {
      description: "新描述",
    });
    assert.equal(merged.description, "新描述");
    assert.equal(merged.name, "beta");
    assert.equal(merged.model, "model-uuid-1");
    assert.deepEqual(merged.prompts, base().prompts);
  });

  it("null 清除字段：删除后回缺省（不再出现在结果里）", () => {
    const merged = mergeAgentDefinitionPatch(base(), { model: null });
    assert.ok(!("model" in merged));
    assert.equal(merged.description, "旧描述");
  });

  it("prompts 子键合并：只填 dynamic 只换 dynamic，persist 保留", () => {
    const newDynamic = [{ name: "d2", content: "新动态块" }];
    const merged = mergeAgentDefinitionPatch(base(), {
      prompts: { dynamic: newDynamic },
    });
    assert.deepEqual(merged.prompts?.persist, base().prompts?.persist);
    assert.deepEqual(merged.prompts?.dynamic, newDynamic);
  });

  it("prompts 子键置 null 清除该布局，另一布局保留", () => {
    const merged = mergeAgentDefinitionPatch(base(), {
      prompts: { dynamic: null },
    });
    assert.deepEqual(merged.prompts?.persist, base().prompts?.persist);
    assert.ok(merged.prompts != null && !("dynamic" in merged.prompts));
  });

  it("prompts 整体置 null：清除整个布局（落盘前由缺省归一补空）", () => {
    const merged = mergeAgentDefinitionPatch(base(), { prompts: null });
    assert.ok(!("prompts" in merged));
  });

  it("改名：patch.name 覆盖现名（唯一性由服务层校验）", () => {
    const merged = mergeAgentDefinitionPatch(base(), { name: "gamma" });
    assert.equal(merged.name, "gamma");
    assert.equal(merged.description, "旧描述");
  });

  it("非法形状透传：prompts 传字符串原样落进结果，交校验层拒绝", () => {
    const merged = mergeAgentDefinitionPatch(base(), {
      prompts: "脏输入",
    });
    assert.equal(merged.prompts, "脏输入");
  });

  it("空 patch：返回与现状等价的副本", () => {
    const current = base();
    const merged = mergeAgentDefinitionPatch(current, {});
    assert.deepEqual(merged, current);
    // 副本语义：不是同一引用（外层与嵌套均不共享）
    assert.notEqual(merged, current);
  });
});
