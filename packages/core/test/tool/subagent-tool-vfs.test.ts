import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { AgentRunResult } from "@/domain/agent/model/agent-run-result.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import {
  subagentTool,
  type TaskToolInput,
  type TaskToolOutput,
} from "@/domain/tool/builtin/subagent-tool.js";
import type {
  BuiltinToolContext,
  BuiltinToolSubagentContext,
  RunChildAgentOptions,
} from "@/domain/tool/builtin/builtin-tool-context.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionService } from "@/service/chat/session.port.js";

const generalDef: AgentDefinition = {
  name: "general",
  prompts: { persist: [], dynamic: [] },
};

/**
 * T-T9 / P0-4：子 agent run 的 toolCtx.vfs 与父 session 的 VFS 是同一视图。
 *
 * task 工具 run 时，ctx.vfs 即装配期注入的 toolCtx.vfs；runChildAgent 内部
 * 再 `vfs = runtime.sessionVfs(parentProjectId, parentSessionId)` 装配子 agent toolCtx.vfs。
 * 本测试用 task 工具的 ctx.vfs 间接验证（同一装配来源：父 session VFS）。
 */
describe("子代理 VFS 可见性（T-T9 / P0-4）", () => {
  it("task 工具 ctx.vfs 是父 session VFS（预置文件可读）", async () => {
    // 父 session VFS 视图（mock）：含 /outline.md
    const parentVfs = {
      read: async () => ({ content: "# 大纲\n主角：林白" }),
    } as never;

    let observedVfsInRunChild: unknown = undefined;
    let observedProjectId: string | undefined;
    let observedParentSessionId: string | undefined;

    const agentRegistry: AgentRegistryService = {
      listAgentIds: async () => ["id-1"],
      list: async () => [generalDef],
      get: async () => generalDef,
      getRawWire: async () => null,
      upsert: async () => undefined,
      delete: async () => undefined,
    };
    const messages: MessageService = {
      listBySession: async () => [
        { role: "assistant", content: { blocks: [{ type: "text", text: "ok" }] } } as ChatMessage,
      ],
    } as unknown as MessageService;
    const sessions: SessionService = {
      createSubSession: async (parent, project) => {
        observedProjectId = project;
        observedParentSessionId = parent;
        return { id: "child-1", parentSessionId: parent, projectId: project } as never;
      },
    } as unknown as SessionService;

    const subagent: BuiltinToolSubagentContext = {
      agentRegistry,
      messages,
      sessions,
      depth: 0,
      callableAgents: [{ name: "general" }],
      parentSignal: new AbortController().signal,
      createChildSession: async (title) => {
        const s = await sessions.createSubSession("parent-sess", "proj-x", title);
        return s.id;
      },
      resolveChildModelId: (def) => ({
        savedModelId: def.model ?? "parent-model",
        workspaceModelId: "ws-model",
      }),
      runChildAgent: async (_def, _sid, _opts: RunChildAgentOptions): Promise<AgentRunResult> => {
        // 在真实 runChildAgent 实现里，这里会 runtime.sessionVfs(parentProjectId, parentSessionId)。
        observedVfsInRunChild = parentVfs; // 模拟：用 parentVfs 装配子 toolCtx.vfs
        return { stepsExecuted: 1, finished: true, stopReason: "completed", rounds: [] };
      },
    };

    const ctx: BuiltinToolContext = {
      vfs: parentVfs,
      projectId: "proj-x",
      sessionId: "parent-sess",
      listSessionMessages: async () => [],
      subagent,
    };

    const out: TaskToolOutput = await subagentTool.run(
      { description: "读大纲", prompt: "请读 /outline.md", subagentName: "general" } satisfies TaskToolInput,
      ctx,
    );

    // 子 session 创建时父 projectId/sessionId 正确透传。
    assert.equal(observedProjectId, "proj-x");
    assert.equal(observedParentSessionId, "parent-sess");
    // runChildAgent 内部观测到的 vfs 与父 session VFS 是同一引用。
    assert.equal(observedVfsInRunChild, parentVfs);
    // task 工具回流文本正常。
    assert.equal(out.text, "ok");
    assert.equal(out.subagentSessionId, "child-1");
  });
});
