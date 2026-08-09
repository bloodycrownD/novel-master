import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAgentPromptLayoutDomain } from "../../src/domain/prompt/logic/normalize-agent-prompt-layout.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import { resolveAgentDefinitionFromStorage } from "../../src/config-forms/stored-config-validity/index.js";

const BASE_LAYOUT: AgentPromptLayout = {
  persist: [],
  dynamic: [],
};

describe("normalizeAgentPromptLayoutDomain: customAttach 透传", () => {
  it("非空 customAttach 原样透传", () => {
    const layout: AgentPromptLayout = {
      ...BASE_LAYOUT,
      customAttach: "额外信息：{{$time}}",
    };
    const normalized = normalizeAgentPromptLayoutDomain(layout);
    assert.equal(normalized.customAttach, "额外信息：{{$time}}");
  });

  it("customAttach 缺省（undefined）→ normalize 后仍为 undefined", () => {
    const normalized = normalizeAgentPromptLayoutDomain({ ...BASE_LAYOUT });
    assert.equal(normalized.customAttach, undefined);
    // 缺省字段不出现在返回对象上，保持与 workplace/system 一致的省略语义。
    assert.ok(!("customAttach" in normalized));
  });

  it("空串 / 纯空白 customAttach 被静默省略（与 validate 端 trim 后空=关 一致）", () => {
    const empty = normalizeAgentPromptLayoutDomain({
      ...BASE_LAYOUT,
      customAttach: "",
    });
    assert.equal(empty.customAttach, undefined);

    const blank = normalizeAgentPromptLayoutDomain({
      ...BASE_LAYOUT,
      customAttach: "   \n  ",
    });
    assert.equal(blank.customAttach, undefined);
  });

  it("同时透传 system / persist / dynamic / customAttach（不互相干扰）", () => {
    const layout: AgentPromptLayout = {
      system: "sys",
      persist: [
        { name: "p1", type: "text", role: "assistant", content: "ok" },
      ],
      dynamic: [
        { name: "d1", type: "text", role: "assistant", content: "a" },
        { name: "d2", type: "text", role: "user", content: "u" },
      ],
      customAttach: "extra",
    };
    const normalized = normalizeAgentPromptLayoutDomain(layout);
    assert.equal(normalized.system, "sys");
    assert.equal(normalized.persist.length, 1);
    assert.equal(normalized.dynamic.length, 2);
    assert.equal(normalized.customAttach, "extra");
  });
});

describe("resolveAgentDefinitionFromStorage: customAttach round-trip", () => {
  it("domain-shape 含 customAttach → 加载 normalize 后不丢", () => {
    // 模拟 registry / agent_config_json.definition 读出的领域形态
    //（prompts.persist 为数组，无 schemaVersion 字段）。
    const stored = {
      name: "writer",
      prompts: {
        persist: [],
        dynamic: [],
        customAttach: "round-trip 附加信息",
      },
    };
    const health = resolveAgentDefinitionFromStorage(stored);
    assert.equal(health.status, "valid");
    if (health.status !== "valid") {
      return;
    }
    assert.equal(health.value.prompts.customAttach, "round-trip 附加信息");
  });

  it("domain-shape customAttach 缺省 → 不回归（保持 undefined 默认语义）", () => {
    const stored = {
      name: "writer",
      prompts: {
        persist: [],
        dynamic: [],
      },
    };
    const health = resolveAgentDefinitionFromStorage(stored);
    assert.equal(health.status, "valid");
    if (health.status !== "valid") {
      return;
    }
    assert.equal(health.value.prompts.customAttach, undefined);
  });
});
