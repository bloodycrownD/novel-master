import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import {
  AgentTurnError,
  flushPendingUserVfsTurnsWithTrailingUserReorder,
  runAgentTurn,
  type AgentTurnRuntimePort,
} from "@/service/agent/logic/run-agent-turn.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";

const sampleDefinition: AgentDefinition = {
  name: "Test",
  prompts: { persist: [], dynamic: [] },
  model: "provider:model",
};

function makeRuntime(overrides: {
  readonly listBySession?: () => Promise<
    ReadonlyArray<{ id?: string; role: string; content: unknown; raw?: unknown }>
  >;
  readonly append?: () => Promise<{ id: string }>;
  readonly delete?: (id: string) => Promise<void>;
  readonly userVfsTurn?: UserVfsTurnService;
}): AgentTurnRuntimePort {
  return {
    state: {
      getCurrentAgentId: async () => "a1",
      getCurrentModelId: async () => "openai/gpt",
      getCurrentRegexGroupId: async () => undefined,
    },
    agentRegistry: {
      listAgentIds: async () => ["a1"],
      get: async () => sampleDefinition,
    },
    messages: {
      listBySession:
        overrides.listBySession ?? (async () => []),
      append:
        overrides.append ??
        (async () => ({ id: "m1", role: "user", content: { blocks: [] } })),
      delete: overrides.delete ?? (async () => undefined),
    } as AgentTurnRuntimePort["messages"],
    messageCheckpoint: {
      capture: async () => undefined,
    } as AgentTurnRuntimePort["messageCheckpoint"],
    modelRequests: {} as AgentTurnRuntimePort["modelRequests"],
    worktreeSnapshot: {
      getOrRefresh: async (_p, _s, render) => {
        const data = await render();
        return {
          worktreeDisplay: data.worktreeDisplay,
          listRows: data.listRows,
          refreshedAtMs: Date.now(),
        };
      },
    } as AgentTurnRuntimePort["worktreeSnapshot"],
    eventBus: {} as AgentTurnRuntimePort["eventBus"],
    regexConfig: {} as AgentTurnRuntimePort["regexConfig"],
    compactionConditionEvaluator:
      undefined as unknown as AgentTurnRuntimePort["compactionConditionEvaluator"],
    eventOrchestrator:
      {} as AgentTurnRuntimePort["eventOrchestrator"],
    sessionVfs: () => ({} as AgentTurnRuntimePort["sessionVfs"] extends (
      ...args: never[]
    ) => infer R
      ? R
      : never),
    worktree: () =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
      }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
    ...(overrides.userVfsTurn != null
      ? { userVfsTurn: overrides.userVfsTurn }
      : {}),
  };
}

describe("runAgentTurn", () => {
  it("rejects empty input when resume is not allowed", async () => {
    await assert.rejects(
      () =>
        runAgentTurn(
          makeRuntime({}),
          { projectId: "p", sessionId: "s" },
          "",
        ),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        assert.equal(err.message, "消息不能为空");
        return true;
      },
    );
  });

  it("does not append user message on empty resume when last is user", async () => {
    let appended = false;
    const runtime = makeRuntime({
      listBySession: async () => [{ role: "user", content: { blocks: [] } }],
      append: async () => {
        appended = true;
        return { id: "m-new" };
      },
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p", sessionId: "s" },
        "",
        { allowResumeWithoutInput: true },
      );
    } catch {
      // Runner deps are stubbed; reaching runner means resume gate passed.
    }
    assert.equal(appended, false);
  });

  it("rejects empty resume when last message is not user", async () => {
    await assert.rejects(
      () =>
        runAgentTurn(
          makeRuntime({
            listBySession: async () => [
              { role: "assistant", content: { blocks: [] } },
            ],
          }),
          { projectId: "p", sessionId: "s" },
          "",
          { allowResumeWithoutInput: true },
        ),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        return true;
      },
    );
  });

  it("flushPendingUserVfsTurns 在 append user 之前调用", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      userVfsTurn: {
        executeOp: async () => ({ ok: true }),
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: false };
        },
      } as UserVfsTurnService,
      append: async () => {
        order.push("append");
        return { id: "m-new" };
      },
    });
    try {
      await runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, "hello");
    } catch {
      // runner deps stubbed
    }
    assert.deepEqual(order, ["flush", "append"]);
  });

  it("空请求续跑时 flush 在跑 Agent 之前、不 append 新 user", async () => {
    const order: string[] = [];
    let appended = false;
    const runtime = makeRuntime({
      listBySession: async () => [
        { id: "u-trail", role: "user", content: { blocks: [] } },
      ],
      delete: async (id) => {
        order.push(`delete:${id}`);
      },
      userVfsTurn: {
        executeOp: async () => ({ ok: true }),
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: true };
        },
      } as UserVfsTurnService,
      append: async () => {
        appended = true;
        order.push("append");
        return { id: "m-new" };
      },
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p", sessionId: "s" },
        "",
        { allowResumeWithoutInput: true },
      );
    } catch {
      // runner deps stubbed
    }
    assert.deepEqual(order, ["delete:u-trail", "flush", "append"]);
    // append 仅用于写回末条 user，非新正文
    assert.equal(appended, true);
  });

  it("空续跑且末条 user 时 delete→flush→reappend 顺序", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      listBySession: async () => [
        { id: "a1", role: "assistant", content: { blocks: [] } },
        {
          id: "u-trail",
          role: "user",
          content: { blocks: [{ type: "text", text: "续跑" }] },
          raw: { marker: 1 },
        },
      ],
      delete: async (id) => {
        order.push(`delete:${id}`);
      },
      userVfsTurn: {
        executeOp: async () => ({ ok: true }),
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: true };
        },
      } as UserVfsTurnService,
      append: async () => {
        order.push("append");
        return { id: "u-reappended" };
      },
    });

    await flushPendingUserVfsTurnsWithTrailingUserReorder(
      runtime,
      "s",
      "",
    );

    assert.deepEqual(order, ["delete:u-trail", "flush", "append"]);
  });

  it("pending 为空时空续跑仍写回已删末条 user", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      listBySession: async () => [
        { id: "u-trail", role: "user", content: { blocks: [] } },
      ],
      delete: async (id) => {
        order.push(`delete:${id}`);
      },
      userVfsTurn: {
        executeOp: async () => ({ ok: true }),
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: false };
        },
      } as UserVfsTurnService,
      append: async () => {
        order.push("append");
        return { id: "u-reappended" };
      },
    });

    await flushPendingUserVfsTurnsWithTrailingUserReorder(
      runtime,
      "s",
      "",
    );

    assert.deepEqual(order, ["delete:u-trail", "flush", "append"]);
  });
});
