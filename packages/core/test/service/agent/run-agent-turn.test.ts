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
  readonly previewUserOpsActions?: UserVfsTurnService["previewUserOpsActions"];
}): UserVfsTurnService {
  return {
    executeOp: async () => ({ ok: true }),
    flushPendingUserVfsTurns:
      overrides.flushPendingUserVfsTurns ??
      (async () => ({ flushed: false, attachments: [] })),
    previewUserOpsChangedPaths:
      overrides.previewUserOpsChangedPaths ?? (async () => []),
    previewUserOpsActions: overrides.previewUserOpsActions ?? (async () => []),
    hasPendingTurns:
      overrides.hasPendingTurns ?? (async () => false),
  };
}

const sampleDefinition: AgentDefinition = {
  name: "Test",
  prompts: { persist: [], dynamic: [] },
  model: "provider:model",
};

/** 空规则视图：materialize 无差集。 */
function emptyRuleView() {
  return { rows: [] as const, displayByPath: new Map() };
}

/** 含单一可见文件的规则视图：materialize 可产出 workplace。 */
function ruleViewWithFile(path: string) {
  return {
    rows: [
      {
        kind: "file" as const,
        path,
        inclusionMode: "include" as const,
        displayState: "full" as const,
      },
    ],
    displayByPath: new Map([[path, "full" as const]]),
  };
}

function makeRuntime(overrides: {
  readonly listBySession?: () => Promise<
    ReadonlyArray<{ id?: string; role: string; content: unknown; raw?: unknown }>
  >;
  readonly append?: (
    sessionId: string,
    role: string,
    content: unknown,
    opts?: { attachments?: readonly unknown[] },
  ) => Promise<{ id: string }>;
  readonly delete?: (id: string) => Promise<void>;
  readonly userVfsTurn?: UserVfsTurnService;
  readonly evaluateRuleView?: () => Promise<ReturnType<typeof emptyRuleView>>;
  readonly listKeys?: (sessionId: string, domain: string) => Promise<string[]>;
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
        evaluateRuleView:
          overrides.evaluateRuleView ?? (async () => emptyRuleView()),
      }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
    sessionKkv: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      clearDomain: async () => undefined,
      clearSession: async () => undefined,
      listKeys: overrides.listKeys ?? (async () => []),
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
                content: '<action name="write">\n{"path":"/x.md","content":""}\n</action>',

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

  it("仅 attach attachments 非空允许发送并 append", async () => {
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
            source: "attach",
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

  it("T-SR1：丢弃预览 workplace/user_ops；materialize 落库 source:workplace；user_ops 来自 flush", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    let appendedOpts:
      | { attachments?: readonly { source?: string; path?: string; content?: string | null }[] }
      | undefined;
    const flushContent =
      '<action name="write">\n{"path":"/ops.md","content":""}\n</action>';
    const runtime = makeRuntime({
      evaluateRuleView: async () => ruleViewWithFile("/delta.md"),
      listKeys: async () => [],
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => ({
          flushed: true,
          attachments: [
            {
              name: "write",
              source: "user_ops",
              type: "text",
              content: flushContent,
            },
          ],
        }),
      }),
      append: async (_sid, _role, _content, opts) => {
        appendedOpts = opts;
        return { id: "m-sr1" };
      },
    });
    try {
      await runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, "", {
        attachments: [
          {
            name: "preview-wp",
            source: "workplace",
            type: "text",
            content: null,
            path: "/stale-preview.md",
          },
          {
            name: "preview-ops",
            source: "user_ops",
            type: "text",
            content: null,
          },
          {
            name: "chip.md",
            source: "attach",
            type: "text",
            content: null,
            path: "/chip.md",
          },
        ],
      });
    } catch {
      // runner deps stubbed
    }
    const atts = appendedOpts?.attachments ?? [];
    assert.ok(
      atts.some((a) => a.source === "workplace" && a.path === "/delta.md"),
      "落库须含 materialize 的 workplace",
    );
    assert.equal(
      atts.some((a) => a.path === "/stale-preview.md"),
      false,
      "不得原样保留预览 workplace",
    );
    const ops = atts.filter((a) => a.source === "user_ops");
    assert.equal(ops.length, 1);
    assert.equal(ops[0]?.content, flushContent);
    assert.ok(atts.some((a) => a.source === "attach" && a.path === "/chip.md"));
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-SR1b：空正文+仅 workplace 差集 → append 含 workplace；误置 allowResume 亦不纯 resume", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    let appendCount = 0;
    let appendedOpts:
      | { attachments?: readonly { source?: string; path?: string }[] }
      | undefined;
    let listCalledForResume = false;
    const runtime = makeRuntime({
      evaluateRuleView: async () => ruleViewWithFile("/only-wp.md"),
      listKeys: async () => [],
      listBySession: async () => {
        listCalledForResume = true;
        return [{ id: "u-trail", role: "user", content: { blocks: [] } }];
      },
      append: async (_sid, _role, _content, opts) => {
        appendCount += 1;
        appendedOpts = opts;
        return { id: "m-sr1b" };
      },
    });
    try {
      await runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, "", {
        allowResumeWithoutInput: true,
      });
    } catch {
      // runner deps stubbed
    }
    assert.equal(appendCount, 1, "有差集须 append，不得纯 resume");
    assert.equal(
      listCalledForResume,
      false,
      "有差集时不得进入 resume-check listBySession",
    );
    assert.ok(
      appendedOpts?.attachments?.some(
        (a) => a.source === "workplace" && a.path === "/only-wp.md",
      ),
    );
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-SR8：re-append merge 含 materialize workplace 且不丢 flush/attach/trailing", async () => {
    let reAppendedAtts:
      | readonly { source?: string; path?: string }[]
      | undefined;
    const runtime = makeRuntime({
      listBySession: async () => [
        {
          id: "u-trail",
          role: "user",
          content: { blocks: [{ type: "text", text: "续跑" }] },
          attachments: [
            {
              name: "/prior.md",
              source: "attach",
              type: "text",
              content: null,
              path: "/prior.md",
            },
          ],
        },
      ],
      delete: async () => undefined,
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => ({
          flushed: true,
          attachments: [
            {
              name: "write",
              source: "user_ops",
              type: "text",
              content: '<action name="write">\n{"path":"/x.md","content":""}\n</action>',
            },
          ],
        }),
      }),
      append: async (_sid, _role, _content, opts) => {
        reAppendedAtts = opts?.attachments as
          | readonly { source?: string; path?: string }[]
          | undefined;
        return { id: "u-re" };
      },
    });

    const result = await prepareUserVfsTurnForAgentRun({
      messages: runtime.messages,
      userVfsTurn: runtime.userVfsTurn!,
      sessionId: "s",
      trimmedInput: "",
      allowResumeWithoutInput: true,
      composerAttachments: [
        {
          name: "chip.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/chip.md",
        },
      ],
      workplaceAttachments: [
        {
          name: "/delta.md",
          source: "workplace",
          type: "text",
          content: null,
          path: "/delta.md",
        },
      ],
    });

    assert.ok(result.reAppendedUserMessageId);
    assert.equal(result.attachments.length, 0);
    const atts = reAppendedAtts ?? [];
    assert.ok(atts.some((a) => a.source === "attach" && a.path === "/prior.md"));
    assert.ok(atts.some((a) => a.source === "attach" && a.path === "/chip.md"));
    assert.ok(atts.some((a) => a.source === "user_ops"));
    assert.ok(
      atts.some((a) => a.source === "workplace" && a.path === "/delta.md"),
    );
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
