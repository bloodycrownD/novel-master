import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import {
  SKILL_TOOL_NAME,
  skillTool,
} from "../../src/domain/tool/builtin/skill-tool.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type {
  EffectiveSkill,
} from "../../src/domain/skills/logic/effective-skills.js";
import type {
  SkillFileContent,
  SkillService,
} from "../../src/service/skills/skills.port.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { assembleSkillsToolContext } from "../../src/service/agent/logic/run-agent-turn.js";
import { resolveAgentToolRegistry } from "../../src/domain/agent/logic/resolve-agent-tool-registry.js";
import type { AgentDefinition } from "../../src/domain/agent/model/agent-definition.js";

/** 构造 fake SkillService：实现 skill 工具用到的服务方法，按调用记录断言。 */
function fakeSkillService(overrides?: {
  readonly read?: SkillService["readSkillFile"];
  readonly write?: SkillService["writeSkillFile"];
  readonly edit?: SkillService["editSkillFile"];
  readonly effective?: SkillService["effectiveSkills"];
  readonly list?: SkillService["listSkills"];
}): SkillService & {
  readonly calls: { readonly method: string; readonly args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  // record 统一包在 override 外层：无论走默认实现还是 override，都记调用。
  const record = <A extends unknown[], R>(
    method: string,
    fn: (...args: A) => R,
  ) => {
    return (...args: A): R => {
      calls.push({ method, args });
      return fn(...args);
    };
  };
  const service = {
    readSkillFile: record(
      "readSkillFile",
      overrides?.read ??
        (async () =>
          ({
            domain: "project",
            name: "demo",
            path: "SKILL.md",
            content: "---\nname: demo\ndescription: 演示\n---\n正文",
            version: 3,
          }) satisfies SkillFileContent),
    ) as SkillService["readSkillFile"],
    writeSkillFile: record(
      "writeSkillFile",
      overrides?.write ?? (async () => ({ version: 5 })),
    ) as SkillService["writeSkillFile"],
    editSkillFile: record(
      "editSkillFile",
      overrides?.edit ?? (async () => ({ version: 6, replacements: 1 })),
    ) as SkillService["editSkillFile"],
    effectiveSkills: record(
      "effectiveSkills",
      overrides?.effective ??
        (async () =>
          [
            {
              name: "demo",
              description: "演示技能",
              domain: "project",
              overridden: false,
              disabled: false,
              valid: true,
              effective: true,
            },
            {
              name: "global-only",
              description: null,
              domain: "global",
              overridden: false,
              disabled: true,
              valid: true,
              effective: false,
            },
          ] satisfies EffectiveSkill[]),
    ) as SkillService["effectiveSkills"],
    listSkills: record(
      "listSkills",
      overrides?.list ?? (async () => []),
    ) as SkillService["listSkills"],
    setDisabled: record("setDisabled", async () => undefined),
    deleteSkill: record("deleteSkill", async () => undefined),
  } as unknown as SkillService & {
    readonly calls: { readonly method: string; readonly args: unknown[] }[];
  };
  return Object.assign(service, { calls });
}

function skillToolCtx(
  service: SkillService,
  effective: readonly EffectiveSkill[] = [],
  referencedNames?: Set<string>,
): BuiltinToolContext {
  return {
    vfs: {} as never,
    projectId: "proj-1",
    sessionId: "sess-1",
    listSessionMessages: async () => [],
    skills: { service, projectId: "proj-1", effective, ...(referencedNames != null ? { referencedNames } : {}) },
  };
}

function makeRunner(): {
  readonly runner: ToolRunner<BuiltinToolContext>;
  readonly registry: ToolRegistry<BuiltinToolContext>;
} {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return { runner: new ToolRunner(registry), registry };
}

describe("skill 工具", () => {
  it("registerBuiltinTools 注册 skill（共 10 个内置工具）", () => {
    const { registry } = makeRunner();
    assert.ok(registry.list().includes(SKILL_TOOL_NAME));
    assert.equal(registry.list().length, 10);
  });

  it("load：读生效副本 SKILL.md 全文并附附属文件清单（过滤 SKILL.md）", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService({
      read: async () => ({
        domain: "project",
        name: "demo",
        path: "SKILL.md",
        content: "技能正文",
        version: 3,
      }),
      list: async () => [
        {
          name: "demo",
          description: "演示",
          domain: "project",
          valid: true,
          files: ["SKILL.md", "references/x.md", "assets/tpl.txt"],
        },
      ],
    });
    const out = await runner.call(
      SKILL_TOOL_NAME,
      { action: "load", name: "demo" },
      skillToolCtx(svc),
    );
    const parsed = out as {
      action: string;
      domain: string;
      content: string;
      files: string[];
      truncated: boolean;
      version: number;
    };
    assert.equal(parsed.action, "load");
    assert.equal(parsed.domain, "project");
    assert.equal(parsed.content, "技能正文");
    assert.deepEqual(parsed.files, ["references/x.md", "assets/tpl.txt"]);
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.version, 3);
    // read 走缺省域（undefined 由服务层解析生效副本）
    const readCall = svc.calls.find((c) => c.method === "readSkillFile");
    assert.deepEqual(readCall?.args.slice(0, 3), [undefined, "demo", undefined]);
  });

  it("load：本请求提示词已引用（referencedNames 命中）→ 短提示不重复注入", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService({
      read: async () => ({
        domain: "global",
        name: "demo",
        path: "SKILL.md",
        content: "很长的正文",
        version: 4,
      }),
    });
    const referenced = new Set(["demo"]);
    const out = await runner.call(
      SKILL_TOOL_NAME,
      { action: "load", name: "demo" },
      skillToolCtx(svc, [], referenced),
    );
    const parsed = out as {
      content: string;
      files: string[];
      alreadyReferenced?: boolean;
      domain: string;
    };
    assert.equal(parsed.alreadyReferenced, true);
    assert.ok(parsed.content.includes("已在"));
    assert.deepEqual(parsed.files, []);
    assert.equal(parsed.domain, "global");
    // 短提示路径不查文件清单
    assert.equal(svc.calls.some((c) => c.method === "listSkills"), false);
  });

  it("load：name 缺失报 INVALID_ARGUMENT", async () => {
    const { runner } = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          SKILL_TOOL_NAME,
          { action: "load" },
          skillToolCtx(fakeSkillService()),
        ),
      (e: unknown) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("read：缺省域透传 undefined 由服务层解析生效副本，输出携带实际命中域", async () => {
    const { runner } = makeRunner();
    const out = await runner.call(
      SKILL_TOOL_NAME,
      { action: "read", name: "demo" },
      skillToolCtx(fakeSkillService()),
    );
    assert.deepEqual(
      (out as { domain: string }).domain,
      "project",
      "read 输出应携带生效副本解析后的命中域",
    );
  });

  it("read：project 覆盖 global 同名——服务层命中 project 副本时透传该结果", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService({
      read: async (domain, name, path, projectId) => {
        // 镜像真实 SkillService 的生效副本解析：domain 缺省先 project 后 global
        assert.equal(domain, undefined);
        assert.equal(name, "shared-name");
        assert.equal(projectId, "proj-1");
        return {
          domain: "project",
          name,
          path: path ?? "SKILL.md",
          content: "项目副本内容",
          version: 2,
        };
      },
    });
    const out = await runner.call(
      SKILL_TOOL_NAME,
      { action: "read", name: "shared-name" },
      skillToolCtx(svc),
    );
    const parsed = out as {
      domain: string;
      content: string;
      totalLines: number;
    };
    assert.equal(parsed.domain, "project");
    assert.equal(parsed.content, "项目副本内容");
    assert.equal(parsed.totalLines, 1);
  });

  it("read：分页 offset 超出文件长度报 INVALID_ARGUMENT", async () => {
    const { runner } = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          SKILL_TOOL_NAME,
          { action: "read", name: "demo", offset: 99 },
          skillToolCtx(fakeSkillService()),
        ),
      (e: unknown) => e instanceof ToolError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("write：domain 缺省补 project，content 缺失报 INVALID_ARGUMENT", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService();
    const out = await runner.call(
      SKILL_TOOL_NAME,
      { action: "write", name: "demo", content: "新内容" },
      skillToolCtx(svc),
    );
    const writeCall = svc.calls.find((c) => c.method === "writeSkillFile");
    assert.ok(writeCall != null);
    assert.equal(writeCall.args[0], "project", "write 缺省域应为 project");
    assert.equal(writeCall.args[1], "demo");
    assert.equal(writeCall.args[2], undefined, "path 缺省透传 undefined");
    assert.equal(writeCall.args[3], "新内容");
    assert.equal(writeCall.args[4], "proj-1");
    assert.equal((out as { path: string }).path, "SKILL.md");

    await assert.rejects(
      () =>
        runner.call(
          SKILL_TOOL_NAME,
          { action: "write", name: "demo" },
          skillToolCtx(fakeSkillService()),
        ),
      (e: unknown) =>
        e instanceof ToolError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("edit：局部改透传 oldString/newString，输出带替换数", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService({
      edit: async () => ({ version: 7, replacements: 2 }),
    });
    const out = await runner.call(
      SKILL_TOOL_NAME,
      {
        action: "edit",
        name: "demo",
        oldString: "旧文本",
        newString: "新文本",
        replaceAll: true,
      },
      skillToolCtx(svc),
    );
    const editCall = svc.calls.find((c) => c.method === "editSkillFile");
    assert.ok(editCall != null);
    assert.equal(editCall.args[0], "project");
    assert.deepEqual(editCall.args[3], {
      oldString: "旧文本",
      newString: "新文本",
      replaceAll: true,
    });
    assert.equal((out as { replacements: number }).replacements, 2);
  });

  it("path 含 .. 段被 schema 拒绝（INVALID_ARGUMENT，不触达服务层）", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService();
    await assert.rejects(
      () =>
        runner.call(
          SKILL_TOOL_NAME,
          { action: "read", name: "demo", path: "notes/../../other/SKILL.md" },
          skillToolCtx(svc),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        JSON.stringify((e as ToolError).details).includes("不得包含 .."),
    );
    assert.equal(
      svc.calls.length,
      0,
      "schema 拦截后不应触达 SkillService",
    );
  });

  it("list：缺省域走 effectiveSkills 合并视图，条目含禁用/覆盖标记", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService();
    const out = await runner.call(
      SKILL_TOOL_NAME,
      { action: "list" },
      skillToolCtx(svc),
    );
    assert.equal((out as { total: number }).total, 2);
    const entries = (out as { entries: { name: string; disabled?: boolean }[] })
      .entries;
    assert.deepEqual(
      entries.map((e) => e.name),
      ["demo", "global-only"],
    );
    assert.equal(entries[1]!.disabled, true);
  });

  it("list：显式 global 域走 listSkills('global')", async () => {
    const { runner } = makeRunner();
    const svc = fakeSkillService();
    await runner.call(
      SKILL_TOOL_NAME,
      { action: "list", domain: "global" },
      skillToolCtx(svc),
    );
    const listCall = svc.calls.find((c) => c.method === "listSkills");
    assert.ok(listCall != null);
    assert.equal(listCall.args[0], "global");
  });

  it("ctx.skills 缺失时 run 抛 FAILED（照 task 未装配先例）", async () => {
    const { runner } = makeRunner();
    await assert.rejects(
      () =>
        runner.call(
          SKILL_TOOL_NAME,
          { action: "list" },
          {
            vfs: {} as never,
            projectId: "p",
            sessionId: "s",
            listSessionMessages: async () => [],
          },
        ),
      (e: unknown) => e instanceof ToolError && e.code === "FAILED",
    );
  });

  it("description lambda：从 ctx.skills.effective 拼「可用技能」清单（仅 effective 条目）", () => {
    const desc = skillTool.description(
      skillToolCtx(fakeSkillService(), [
        {
          name: "novel-outline",
          description: "大纲生成技巧",
          domain: "global",
          overridden: false,
          disabled: false,
          valid: true,
          effective: true,
        },
        {
          name: "disabled-one",
          description: "被禁用",
          domain: "project",
          overridden: false,
          disabled: true,
          valid: true,
          effective: false,
        },
      ]),
    );
    assert.match(desc, /- novel-outline：大纲生成技巧/);
    assert.ok(!desc.includes("disabled-one"), "禁用技能不应进 description");
    assert.match(desc, /action 说明/);
  });

  it("description lambda：ctx.skills 缺失时显示「暂无可用技能」", () => {
    const desc = skillTool.description({
      vfs: {} as never,
      projectId: "p",
      sessionId: "s",
      listSessionMessages: async () => [],
    });
    assert.match(desc, /（暂无可用技能）/);
  });
});

describe("assembleSkillsToolContext（主/子两装配点共用）", () => {
  const def: AgentDefinition = {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };

  function registryWithSkillOpt(denySkillOpt: boolean): ToolRegistry<BuiltinToolContext> {
    const base = new ToolRegistry<BuiltinToolContext>();
    registerBuiltinTools(base);
    if (!denySkillOpt) return base;
    return resolveAgentToolRegistry(
      base,
      { ...def, tools: { deny: [SKILL_TOOL_NAME] } },
      { depth: 0 },
    );
  }

  it("runtime.skills 缺省（未注入）时返回 undefined", async () => {
    const ctx = await assembleSkillsToolContext({}, "p1", registryWithSkillOpt(false));
    assert.equal(ctx, undefined);
  });

  it("registry 含 skill 时预算 effective 清单并注入 projectId", async () => {
    const svc = fakeSkillService();
    const runtime = { skills: () => svc as SkillService };
    const ctx = await assembleSkillsToolContext(
      runtime,
      "proj-9",
      registryWithSkillOpt(false),
    );
    assert.ok(ctx != null);
    assert.equal(ctx.projectId, "proj-9");
    assert.equal(ctx.effective.length, 2);
    const effCall = svc.calls.find((c) => c.method === "effectiveSkills");
    assert.ok(effCall != null);
    assert.equal(effCall.args[0], "proj-9");
  });

  it("deny skill 后 registry 不含它：不注入闭包且不产生预算 IO（D4 注册表侧联动）", async () => {
    const svc = fakeSkillService();
    const runtime = { skills: () => svc as SkillService };
    const registry = registryWithSkillOpt(true);
    assert.ok(!registry.list().includes(SKILL_TOOL_NAME));
    const ctx = await assembleSkillsToolContext(runtime, "proj-9", registry);
    assert.equal(ctx, undefined);
    assert.equal(
      svc.calls.filter((c) => c.method === "effectiveSkills").length,
      0,
      "deny 后不应调用 effectiveSkills（skillsIndex 置空联动属 Step 10）",
    );
  });
});
