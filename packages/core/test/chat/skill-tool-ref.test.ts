import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSkillToolRefFromInput,
  resolveSkillToolRefFromOutput,
} from "../../src/domain/chat/logic/skill-tool-ref.js";

describe("resolveSkillToolRefFromInput（tool_use 输入侧解析）", () => {
  it("write 缺省域补 project，携带会话 projectId", () => {
    assert.deepEqual(
      resolveSkillToolRefFromInput(
        "skill",
        { action: "write", name: "demo", content: "x" },
        "proj-1",
      ),
      { domain: "project", projectId: "proj-1", name: "demo" },
    );
  });

  it("edit 显式 global 域：不带 projectId（global 无需定位上下文）", () => {
    assert.deepEqual(
      resolveSkillToolRefFromInput(
        "skill",
        { action: "edit", name: "demo", domain: "global", oldString: "a", newString: "b" },
        "proj-1",
      ),
      { domain: "global", name: "demo" },
    );
  });

  it("read 缺省域返回 undefined——实际命中域只有工具输出知道，等 meta.skillRef", () => {
    assert.equal(
      resolveSkillToolRefFromInput(
        "skill",
        { action: "read", name: "demo" },
        "proj-1",
      ),
      undefined,
    );
  });

  it("read 显式 project 域可解析（pending 卡片也能跳）", () => {
    assert.deepEqual(
      resolveSkillToolRefFromInput(
        "skill",
        { action: "read", name: "demo", domain: "project" },
        "proj-1",
      ),
      { domain: "project", projectId: "proj-1", name: "demo" },
    );
  });

  it("list 无目标技能，返回 undefined", () => {
    assert.equal(
      resolveSkillToolRefFromInput("skill", { action: "list" }, "p"),
      undefined,
    );
  });

  it("非 skill 工具一律返回 undefined", () => {
    assert.equal(
      resolveSkillToolRefFromInput("write", { action: "write", name: "demo" }),
      undefined,
    );
  });

  it("name 缺失返回 undefined；非法 domain 值按缺省回落（镜像工具层默认）", () => {
    assert.equal(
      resolveSkillToolRefFromInput("skill", { action: "write" }),
      undefined,
    );
    // 非法 domain 值在工具 schema 层已被拒；这里防御性按缺省处理（write/edit → project）
    assert.deepEqual(
      resolveSkillToolRefFromInput("skill", {
        action: "write",
        name: "demo",
        domain: "team",
      }),
      { domain: "project", name: "demo" },
    );
  });

  it("projectId 缺省时 project 域 ref 不带该字段", () => {
    assert.deepEqual(
      resolveSkillToolRefFromInput("skill", {
        action: "write",
        name: "demo",
      }),
      { domain: "project", name: "demo" },
    );
  });
});

describe("resolveSkillToolRefFromOutput（工具输出侧自动检测）", () => {
  it("read 输出携带生效副本命中域：透传并补 skillProjectId", () => {
    assert.deepEqual(
      resolveSkillToolRefFromOutput(
        "skill",
        {
          action: "read",
          domain: "project",
          name: "demo",
          path: "SKILL.md",
          content: "...",
        },
        "proj-1",
      ),
      { domain: "project", projectId: "proj-1", name: "demo" },
    );
  });

  it("load 输出携带生效副本命中域：透传并补 skillProjectId", () => {
    assert.deepEqual(
      resolveSkillToolRefFromOutput(
        "skill",
        {
          action: "load",
          domain: "project",
          name: "demo",
          path: "SKILL.md",
          content: "...",
          version: 1,
          files: ["references/x.md"],
          truncated: false,
        },
        "proj-1",
      ),
      { domain: "project", projectId: "proj-1", name: "demo" },
    );
  });

  it("read 命中 global 副本：不带 projectId", () => {
    assert.deepEqual(
      resolveSkillToolRefFromOutput(
        "skill",
        { action: "read", domain: "global", name: "demo" },
        "proj-1",
      ),
      { domain: "global", name: "demo" },
    );
  });

  it("write/edit 输出同样可解析（输出必带实际 domain/name）", () => {
    assert.deepEqual(
      resolveSkillToolRefFromOutput("skill", {
        action: "edit",
        domain: "global",
        name: "demo",
        path: "SKILL.md",
        replacements: 2,
      }),
      { domain: "global", name: "demo" },
    );
  });

  it("list 输出无目标技能，返回 undefined", () => {
    assert.equal(
      resolveSkillToolRefFromOutput("skill", {
        action: "list",
        entries: [],
        total: 0,
      }),
      undefined,
    );
  });

  it("非 skill 工具名或非对象输出返回 undefined", () => {
    assert.equal(
      resolveSkillToolRefFromOutput("read", {
        action: "read",
        domain: "project",
        name: "demo",
      }),
      undefined,
    );
    assert.equal(
      resolveSkillToolRefFromOutput("skill", "not-an-object"),
      undefined,
    );
    assert.equal(
      resolveSkillToolRefFromOutput("skill", null),
      undefined,
    );
  });
});
