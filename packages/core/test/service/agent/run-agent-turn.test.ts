import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import {
  AgentTurnError,
  runAgentTurn,
  type AgentTurnRuntimePort,
} from "@/service/agent/logic/run-agent-turn.js";
import { prepareUserVfsTurnForAgentRun } from "@/service/agent/logic/prepare-user-vfs-turn-for-agent-run.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import {
  refreshUserVfsUnifiedToolTurnSnapshot,
  resetUserVfsUnifiedToolTurnSnapshotForTests,
} from "@/domain/feature-flags/user-vfs-unified-tool-turn.js";
function mockUserVfsTurn(overrides: {
  readonly flushPendingUserVfsTurns?: UserVfsTurnService["flushPendingUserVfsTurns"];
  readonly hasPendingTurns?: UserVfsTurnService["hasPendingTurns"];
  readonly previewUserOpsChangedPaths?: UserVfsTurnService["previewUserOpsChangedPaths"];
}): UserVfsTurnService {
  return {
    executeOp: async () => ({ ok: true }),
    flushPendingUserVfsTurns:
      overrides.flushPendingUserVfsTurns ??
      (async () => ({ flushed: false, attachments: [] })),
    previewUserOpsChangedPaths:
      overrides.previewUserOpsChangedPaths ?? (async () => []),
    hasPendingTurns:
      overrides.hasPendingTurns ?? (async () => false),
  };
}

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
    projects: {
      getAgentConfig: async () => ({ mode: "follow" }),
    } as AgentTurnRuntimePort["projects"],
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
        materializePersistBlock: async () => ({ worktreeDisplay: "" }),
      }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
    sessionKkv: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      clearSession: async () => undefined,
      listKeys: async () => [],
    },
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

  it("flag 关闭时不调用 flush", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    let flushCalled = false;
    const runtime = makeRuntime({
      userVfsTurn: mockUserVfsTurn({
        flushPendingUserVfsTurns: async () => {
          flushCalled = true;
          return { flushed: false, attachments: [] };
        },
      }),
      append: async () => ({ id: "m-new" }),
    });
    try {
      await runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, "hello");
    } catch {
      // runner deps stubbed
    }
    assert.equal(flushCalled, false);
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("flushPendingUserVfsTurns 在 append user 之前调用", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      userVfsTurn: mockUserVfsTurn({
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: false, attachments: [] };
        },
      }),
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
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return {
            flushed: true,
            attachments: [
              {
                name: "write",
                source: "user_ops",
                type: "text",
                content: '<user-vfs-action kind="save" path="/x.md" />',
              },
            ],
          };
        },
      }),
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
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: true, attachments: [] };
        },
      }),
      append: async () => {
        order.push("append");
        return { id: "u-reappended" };
      },
    });

    await prepareUserVfsTurnForAgentRun({
      messages: runtime.messages,
      userVfsTurn: runtime.userVfsTurn!,
      sessionId: "s",
      trimmedInput: "",
      allowResumeWithoutInput: true,
    });

    assert.deepEqual(order, ["delete:u-trail", "flush", "append"]);
  });

  it("net diff 空 flush 返回 flushed:false 时仍重排末条 user", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      listBySession: async () => [
        {
          id: "u-trail",
          role: "user",
          content: { blocks: [{ type: "text", text: "续跑" }] },
        },
      ],
      delete: async (id) => {
        order.push(`delete:${id}`);
      },
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: false, attachments: [] };
        },
      }),
      append: async () => {
        order.push("append");
        return { id: "u-reappended" };
      },
    });

    await prepareUserVfsTurnForAgentRun({
      messages: runtime.messages,
      userVfsTurn: runtime.userVfsTurn!,
      sessionId: "s",
      trimmedInput: "",
      allowResumeWithoutInput: true,
    });

    assert.deepEqual(order, ["delete:u-trail", "flush", "append"]);
  });

  it("pending 为空时空续跑不重排末条 user", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      listBySession: async () => [
        { id: "u-trail", role: "user", content: { blocks: [] } },
      ],
      delete: async (id) => {
        order.push(`delete:${id}`);
      },
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => false,
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: false, attachments: [] };
        },
      }),
      append: async () => {
        order.push("append");
        return { id: "u-reappended" };
      },
    });

    await prepareUserVfsTurnForAgentRun({
      messages: runtime.messages,
      userVfsTurn: runtime.userVfsTurn!,
      sessionId: "s",
      trimmedInput: "",
      allowResumeWithoutInput: true,
    });

    assert.deepEqual(order, ["flush"]);
  });

  it("无 allowResumeWithoutInput 时 trimmed 空不删末条 user", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      listBySession: async () => [
        { id: "u-trail", role: "user", content: { blocks: [] } },
      ],
      delete: async (id) => {
        order.push(`delete:${id}`);
      },
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          return { flushed: true, attachments: [] };
        },
      }),
      append: async () => {
        order.push("append");
        return { id: "u-reappended" };
      },
    });

    await prepareUserVfsTurnForAgentRun({
      messages: runtime.messages,
      userVfsTurn: runtime.userVfsTurn!,
      sessionId: "s",
      trimmedInput: "",
    });

    assert.deepEqual(order, ["flush"]);
  });

  it("T-AT5: 手输 @path 入库 attachments 且 content 保留 token", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    let appendedContent: unknown;
    let appendedOptions: { attachments?: readonly { path?: string; source?: string }[] } | undefined;
    const runtime = makeRuntime({
      append: async (_sid, _role, content, opts) => {
        appendedContent = content;
        appendedOptions = opts;
        return { id: "m-at5" };
      },
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p", sessionId: "s" },
        "请看 @notes/a.md",
      );
    } catch {
      // runner deps stubbed
    }
    assert.deepEqual(appendedContent, {
      blocks: [{ type: "text", text: "请看 @notes/a.md" }],
    });
    assert.equal(appendedOptions?.attachments?.length, 1);
    assert.equal(appendedOptions?.attachments?.[0]?.source, "attach");
    assert.equal(appendedOptions?.attachments?.[0]?.path, "notes/a.md");
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-AT6: chips 与手输同一 @path 发送时按 path 去重", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    let appendedOptions: { attachments?: readonly { path?: string }[] } | undefined;
    const runtime = makeRuntime({
      append: async (_sid, _role, _content, opts) => {
        appendedOptions = opts;
        return { id: "m-at6" };
      },
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p", sessionId: "s" },
        "再提 @notes/a.md",
        {
          attachments: [
            {
              name: "a.md",
              source: "attach",
              type: "text",
              content: null,
              path: "notes/a.md",
            },
          ],
        },
      );
    } catch {
      // runner deps stubbed
    }
    assert.equal(appendedOptions?.attachments?.length, 1);
    assert.equal(appendedOptions?.attachments?.[0]?.path, "notes/a.md");
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("仅 attachments 非空允许发送并 append", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    let appended = false;
    const runtime = makeRuntime({
      append: async () => {
        appended = true;
        return { id: "m-attach-only" };
      },
    });
    try {
      await runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, "", {
        attachments: [
          {
            name: "a.md",
            source: "workplace",
            type: "text",
            content: null,
            path: "/a.md",
          },
        ],
      });
    } catch {
      // runner deps stubbed
    }
    assert.equal(appended, true);
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("flush 失败时仍写回已删末条 user", async () => {
    const order: string[] = [];
    const runtime = makeRuntime({
      listBySession: async () => [
        {
          id: "u-trail",
          role: "user",
          content: { blocks: [{ type: "text", text: "续跑" }] },
        },
      ],
      delete: async (id) => {
        order.push(`delete:${id}`);
      },
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => {
          order.push("flush");
          throw new Error("flush failed");
        },
      }),
      append: async () => {
        order.push("append");
        return { id: "u-reappended" };
      },
    });

    await assert.rejects(
      () =>
        prepareUserVfsTurnForAgentRun({
          messages: runtime.messages,
          userVfsTurn: runtime.userVfsTurn!,
          sessionId: "s",
          trimmedInput: "",
          allowResumeWithoutInput: true,
        }),
      /flush failed/,
    );

    assert.deepEqual(order, ["delete:u-trail", "flush", "append"]);
  });
});
