import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import { buildUserOpsAttachmentFromEntry } from "@/domain/chat/logic/build-user-ops-attachment.js";
import {
  refreshUserVfsUnifiedToolTurnSnapshot,
  resetUserVfsUnifiedToolTurnSnapshotForTests,
} from "@/domain/feature-flags/user-vfs-unified-tool-turn.js";
import { buildUserVfsSaveWriteActionXml } from "@/domain/vfs/logic/user-vfs-save-mapping.js";
import {
  AgentTurnError,
  runAgentTurn,
  type AgentTurnRuntimePort,
} from "@/service/agent/logic/run-agent-turn.js";
import { prepareUserVfsTurnForAgentRun } from "@/service/agent/logic/prepare-user-vfs-turn-for-agent-run.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";

/** 与生产 flush 同源：`buildUserOpsAttachmentFromEntry`（含 path/action）。 */
function flushWriteUserOpsAttachment(path: string, content = "") {
  return buildUserOpsAttachmentFromEntry({
    action: "write",
    path,
    xml: buildUserVfsSaveWriteActionXml(path, "new-file", content),
  });
}

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

/** 开启常驻工作区：materialize / 差集用例用。 */
const workplaceOnDefinition: AgentDefinition = {
  ...sampleDefinition,
  prompts: { persist: [], dynamic: [], workplace: "【done】" },
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
  /** 覆盖 messageCheckpoint.capture（默认 no-op）。 */
  readonly capture?: (
    sessionId: string,
    projectId: string,
    messageId: string,
  ) => Promise<void>;
  /** 覆盖 messageCheckpoint.release（默认 no-op；S-1 回滚路径用）。 */
  readonly release?: (
    sessionId: string,
    messageId: string,
  ) => Promise<void>;
  /** 覆盖 messageCheckpoint.backfillMissingBaselines（默认 no-op）。 */
  readonly backfillMissingBaselines?: (
    sessionId: string,
    projectId: string,
  ) => Promise<void>;
  /** 覆盖 agentRegistry.get 返回的 definition（默认 sampleDefinition）。 */
  readonly definition?: AgentDefinition;
}): AgentTurnRuntimePort {
  const definition = overrides.definition ?? sampleDefinition;
  return {
    state: {
      getCurrentAgentId: async () => "a1",
      getCurrentModelId: async () => "openai/gpt",
      getCurrentRegexGroupId: async () => undefined,
    },
    agentRegistry: {
      listAgentIds: async () => ["a1"],
      get: async () => definition,
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
      capture:
        overrides.capture ?? (async () => undefined),
      release: overrides.release ?? (async () => undefined),
      backfillMissingBaselines:
        overrides.backfillMissingBaselines ?? (async () => undefined),
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
    workplace: () =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
        evaluateRuleView:
          overrides.evaluateRuleView ?? (async () => emptyRuleView()),
      }) as ReturnType<AgentTurnRuntimePort["workplace"]>,
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
    sessions: {
      getSessionAgentConfig: async () => ({ mode: "follow" }),
    },
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
            attachments: [flushWriteUserOpsAttachment("/x.md")],
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

  // 落库 path 一律带前导 `/`（composer-at-token-prompt-dedup SPEC / scanAtPathAttachments）
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
    assert.equal(appendedOptions?.attachments?.[0]?.path, "/notes/a.md");
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
              path: "/notes/a.md",
            },
          ],
        },
      );
    } catch {
      // runner deps stubbed
    }
    assert.equal(appendedOptions?.attachments?.length, 1);
    assert.equal(appendedOptions?.attachments?.[0]?.path, "/notes/a.md");
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

  it("T-SR1：丢弃预览 workplace/user_ops；不 materialize workplace；user_ops 来自 flush", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    let appendedOpts:
      | {
          attachments?: readonly {
            source?: string;
            path?: string;
            content?: string | null;
            action?: string;
            name?: string;
          }[];
        }
      | undefined;
    const flushAtt = flushWriteUserOpsAttachment("/delta.md");
    const runtime = makeRuntime({
      definition: workplaceOnDefinition,
      evaluateRuleView: async () => ruleViewWithFile("/delta.md"),
      listKeys: async () => [],
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => ({
          flushed: true,
          attachments: [flushAtt],
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
    assert.equal(
      atts.some((a) => a.source === "workplace"),
      false,
      "新路径不得 materialize / 保留预览 workplace",
    );
    assert.equal(
      atts.some((a) => a.path === "/stale-preview.md"),
      false,
      "不得原样保留预览 workplace",
    );
    const ops = atts.filter((a) => a.source === "user_ops");
    assert.equal(ops.length, 1);
    assert.equal(ops[0]?.path, "/delta.md");
    assert.equal(ops[0]?.action, "write");
    assert.equal(ops[0]?.name, "/delta.md");
    assert.equal(ops[0]?.content, flushAtt.content);
    assert.ok(atts.some((a) => a.source === "attach" && a.path === "/chip.md"));
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-CR3：空正文+仅规则可见文件（无 pending/批注）→ 抛「消息不能为空」且不 append", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    let appendCount = 0;
    let evaluateCalled = false;
    const runtime = makeRuntime({
      definition: workplaceOnDefinition,
      evaluateRuleView: async () => {
        evaluateCalled = true;
        return ruleViewWithFile("/only-wp.md");
      },
      listKeys: async () => [],
      append: async () => {
        appendCount += 1;
        return { id: "m-cr3" };
      },
    });
    await assert.rejects(
      () =>
        runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, ""),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        assert.equal(err.message, "消息不能为空");
        return true;
      },
    );
    assert.equal(appendCount, 0, "仅规则变更不得 append user");
    assert.equal(
      evaluateCalled,
      false,
      "发送路径不得再 evaluateRuleView materialize",
    );
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("B-01：空输入且末条 assistant → 抛「消息不能为空」、不 append 空 user", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    const existing = [
      {
        id: "a1",
        role: "assistant" as const,
        content: { blocks: [{ type: "text" as const, text: "模型回复" }] },
      },
    ];
    let appendCount = 0;
    const runtime = makeRuntime({
      definition: workplaceOnDefinition,
      evaluateRuleView: async () => ruleViewWithFile("/visible.md"),
      listKeys: async () => [],
      listBySession: async () => existing,
      append: async () => {
        appendCount += 1;
        return { id: "m-b01-bad" };
      },
    });
    await assert.rejects(
      () => runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, ""),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        assert.equal(err.message, "消息不能为空");
        return true;
      },
    );
    assert.equal(appendCount, 0, "末条 assistant 不得误 append");
    const after = await runtime.messages.listBySession("s");
    assert.equal(after.length, existing.length, "listBySession 长度不变");
    assert.equal(
      after.some((m) => m.role === "user"),
      false,
      "不得新增空 user",
    );
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("A7: workplace=false → 空输入仍抛「消息不能为空」", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    let appendCount = 0;
    const runtime = makeRuntime({
      // sampleDefinition：workplace 缺省 false
      definition: sampleDefinition,
      evaluateRuleView: async () => ruleViewWithFile("/should-not-send.md"),
      listKeys: async () => [],
      append: async () => {
        appendCount += 1;
        return { id: "m-a7" };
      },
    });
    await assert.rejects(
      () =>
        runAgentTurn(runtime, { projectId: "p", sessionId: "s" }, ""),
      (err: unknown) => {
        assert.ok(err instanceof AgentTurnError);
        assert.equal(err.message, "消息不能为空");
        return true;
      },
    );
    assert.equal(appendCount, 0);
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-SR8：re-append merge 不含 workplace 且不丢 flush/attach/trailing", async () => {
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
          attachments: [flushWriteUserOpsAttachment("/x.md")],
        }),
      }),
      append: async (_sid, _role, _content, opts) => {
        reAppendedAtts = opts?.attachments as
          | readonly { source?: string; path?: string; action?: string }[]
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
    });

    assert.ok(result.reAppendedUserMessageId);
    assert.equal(result.attachments.length, 0);
    const atts = reAppendedAtts ?? [];
    assert.ok(atts.some((a) => a.source === "attach" && a.path === "/prior.md"));
    assert.ok(atts.some((a) => a.source === "attach" && a.path === "/chip.md"));
    assert.ok(
      atts.some(
        (a) =>
          a.source === "user_ops" && a.path === "/x.md" && a.action === "write",
      ),
    );
    assert.ok(
      !atts.some((a) => a.source === "workplace"),
      "re-append merge 不得含 workplace materialize",
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

  // T-DS3（S-13 治本）：普通纯文本 chat 路径下，runAgentTurn 必须为新 append
  // 的 user 消息写 baseline checkpoint。原先仅 userOpsAttachments 非空时才写，
  // 导致 plain chat 无 baseline → undo_send 时 targetTree 空 → 删光工作区。
  it("T-DS3a：普通纯文本 chat 路径为新 user 消息写 baseline checkpoint", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    const captured: Array<{
      sessionId: string;
      projectId: string;
      messageId: string;
    }> = [];
    const runtime = makeRuntime({
      append: async () => ({ id: "u-plain-1" }),
      capture: async (sessionId, projectId, messageId) => {
        captured.push({ sessionId, projectId, messageId });
      },
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p", sessionId: "s" },
        "只是一条纯文本消息",
      );
    } catch {
      // runner deps stubbed；走到 capture 即说明 baseline 已写
    }
    assert.equal(captured.length, 1, "plain chat 必须为新 user 消息写一次 baseline");
    assert.deepEqual(captured[0], {
      sessionId: "s",
      projectId: "p",
      messageId: "u-plain-1",
    });
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  // T-DS3b：baseline checkpoint 写入失败必须向上抛出，不能静默吞掉，否则
  // 调用方无法感知 baseline 缺失，后续 undo_send 仍会撞护栏。
  it("T-DS3b：baseline capture 抛错时 runAgentTurn 向上抛出", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    const runtime = makeRuntime({
      append: async () => ({ id: "u-plain-2" }),
      capture: async () => {
        throw new Error("baseline capture failed");
      },
    });
    await assert.rejects(
      () =>
        runAgentTurn(
          runtime,
          { projectId: "p", sessionId: "s" },
          "纯文本消息",
        ),
      /baseline capture failed/,
    );
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  // T-SC1（S-1 迁移）：runAgentTurn 的 append+capture 链走 CoordinatedWrite 后，
  // capture 步骤抛错时必须逆序回滚——删掉刚 append 的 user 消息，同时入口的
  // backfillMissingBaselines 已为历史消息写了 baseline，会话仍可回滚。
  it("T-SC1：capture 抛错时 append 被逆序回滚、baseline checkpoint 仍存在", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    const deletedIds: string[] = [];
    const released: Array<{ sessionId: string; messageId: string }> = [];
    const backfilled: Array<{ sessionId: string; projectId: string }> = [];
    const runtime = makeRuntime({
      append: async () => ({ id: "u-sc1" }),
      delete: async (id: string) => {
        deletedIds.push(id);
      },
      capture: async () => {
        throw new Error("capture boom");
      },
      release: async (sessionId, messageId) => {
        released.push({ sessionId, messageId });
      },
      backfillMissingBaselines: async (sessionId, projectId) => {
        backfilled.push({ sessionId, projectId });
      },
    });
    await assert.rejects(
      () =>
        runAgentTurn(
          runtime,
          { projectId: "p", sessionId: "s" },
          "会触发 capture 失败的消息",
        ),
      /capture boom/,
    );
    // 入口 baseline 回填仍执行 → 历史消息的 baseline checkpoint 存在、会话可回滚
    assert.equal(backfilled.length, 1, "入口必须调一次 backfillMissingBaselines");
    // append 的补偿动作：刚写入的 user 消息被删
    assert.deepEqual(deletedIds, ["u-sc1"], "capture 失败后 append 必须被逆序回滚");
    // capture 的补偿动作（release）在 execute 抛错前未实际写入，这里仅验证调度路径
    assert.equal(released.length, 0, "capture execute 抛错，其自身回滚不触发");
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  // T-DS5（S-13 扩展）：runAgentTurn 入口必须调一次 backfillMissingBaselines，
  // 给历史空窗消息补 baseline。Step 9 已保证新消息源头有 baseline，但旧会话里
  // 可能还留着 Step 9 之前的消息——这里在 turn 开始时幂等补齐。
  it("T-DS5：runAgentTurn 开始时调一次 backfillMissingBaselines", async () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    const backfilled: Array<{ sessionId: string; projectId: string }> = [];
    const runtime = makeRuntime({
      append: async () => ({ id: "u-backfill-1" }),
      backfillMissingBaselines: async (sessionId, projectId) => {
        backfilled.push({ sessionId, projectId });
      },
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p", sessionId: "s" },
        "继续聊天",
      );
    } catch {
      // runner deps stubbed；走到断言即说明 backfill 已调
    }
    assert.equal(backfilled.length, 1, "每轮发送只能调一次 backfill");
    assert.deepEqual(backfilled[0], { sessionId: "s", projectId: "p" });
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });
});
