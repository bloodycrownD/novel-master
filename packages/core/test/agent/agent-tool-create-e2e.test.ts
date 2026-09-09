/**
 * MF-8(b)：`agent` 工具 create 缺 `definition.name` 的端到端用例。
 *
 * 与 test/tool/agent-tool.test.ts 的 fake registry 单测互补：本文件走真实
 * `agent` 工具 → ToolRunner → DefaultAgentRegistryService → SQLite 落盘
 * 全链路，验证服务层校验错误（INVALID_SCHEMA）被工具层转译成
 * INVALID_ARGUMENT 且文案含「definition.name 必填」，并确认拒绝后
 * 注册表无落盘。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { ToolError } from "../../src/errors/tool-errors.js";
import { createAgentRegistryService } from "@novel-master/core/agent";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function makeRunner(): ToolRunner<BuiltinToolContext> {
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return new ToolRunner(registry);
}

/** 真实链路的工具上下文：registry 接真实 SQLite 连接（非 fake）。 */
function makeRealCtx(): BuiltinToolContext {
  const ctx = getNovelMasterTestContext();
  const registry = createAgentRegistryService(ctx.conn);
  const probe = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(probe);
  return {
    vfs: {} as never,
    projectId: "proj-1",
    sessionId: "sess-1",
    listSessionMessages: async () => [],
    agents: {
      registry,
      agents: [{ name: "general", description: "内置通用 agent", mode: "all" }],
      registeredToolNames: probe.list(),
    },
  };
}

describe("agent 工具 create 端到端（真实 registry）", () => {
  it("缺 definition.name：报错文案含「definition.name 必填」且注册表无落盘", async () => {
    const testCtx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(testCtx.conn);
    const idsBefore = new Set(await registry.listAgentIds());

    await assert.rejects(
      () =>
        makeRunner().call(
          "agent",
          {
            action: "create",
            // definition 给出但顶层缺 name（prompts 也缺省，校验须先拒 name）。
            definition: { description: "缺名字的坏定义", mode: "subagent" },
          },
          makeRealCtx(),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.message.includes("definition.name 必填"),
    );

    // 拒绝后无落盘：持久化 id 集合与调用前一致（无 agent- 前缀新行）。
    const idsAfter = await registry.listAgentIds();
    assert.deepEqual([...idsAfter].sort(), [...idsBefore].sort());
  });
});

describe("agent 工具 update patch 端到端（真实 registry）", () => {
  it("patch 只改 description：其余字段与 prompts 布局保留，get 可读回", async () => {
    const testCtx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(testCtx.conn);
    // 种一个带完整字段的现状
    const agentId = "agent-patch-e2e-1";
    await registry.upsert(agentId, {
      name: "patch-e2e-alpha",
      description: "旧描述",
      model: undefined,
      prompts: {
        persist: [{ name: "p1", role: "user", content: "持久块" }],
        dynamic: [],
      },
    } as never);

    const out = await makeRunner().call(
      "agent",
      {
        action: "update",
        agentId,
        // patch：只改 description，未填 name/prompts
        definition: { description: "新描述" },
      },
      makeRealCtx(),
    );
    assert.equal(out.action, "update");

    // 读回：description 已改，prompts 布局原样保留
    const saved = await registry.get(agentId);
    assert.equal(saved.description, "新描述");
    assert.equal(saved.name, "patch-e2e-alpha");
    // wire 往返会给块补 type: "text"（归一），断言对齐落盘后的形状。
    assert.deepEqual(saved.prompts, {
      persist: [
        { name: "p1", type: "text", role: "user", content: "持久块" },
      ],
      dynamic: [],
    });

    await registry.delete(agentId);
  });

  it("patch 改名撞名：服务层 DUPLICATE_NAME 转译为 INVALID_ARGUMENT", async () => {
    const testCtx = getNovelMasterTestContext();
    const registry = createAgentRegistryService(testCtx.conn);
    const a = "agent-patch-e2e-a";
    const b = "agent-patch-e2e-b";
    await registry.upsert(a, { name: "dup-target" } as never);
    await registry.upsert(b, { name: "dup-source" } as never);

    await assert.rejects(
      () =>
        makeRunner().call(
          "agent",
          { action: "update", agentId: b, definition: { name: "dup-target" } },
          makeRealCtx(),
        ),
      (e: unknown) =>
        e instanceof ToolError &&
        e.code === "INVALID_ARGUMENT" &&
        e.message.includes("已存在"),
    );

    await registry.delete(a);
    await registry.delete(b);
  });
});
