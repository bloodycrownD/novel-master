/**
 * annotateDrafts 发送契约（T-AN3/T-AN4/T-AN6 Core 位点）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import {
  AgentTurnError,
  runAgentTurn,
  type AgentTurnRuntimePort,
} from "@/service/agent/logic/run-agent-turn.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";
import {
  refreshUserVfsUnifiedToolTurnSnapshot,
  resetUserVfsUnifiedToolTurnSnapshotForTests,
} from "@/domain/feature-flags/user-vfs-unified-tool-turn.js";
import { hasComposerSendableInput } from "@/domain/chat/logic/composer-sendable-input.js";
import { wrapUserMessageForLlm } from "@/domain/chat/logic/wrap-user-message-for-llm.js";
import { buildAnnotateAttachmentFromDraft } from "@/domain/chat/logic/build-attachment-action-xml.js";
import { mergeAttachmentsByPath } from "@/domain/chat/logic/scan-at-path-attachments.js";
import type { MessageAttachment } from "@/domain/chat/model/message-attachment.schema.js";

const sampleDefinition: AgentDefinition = {
  name: "Test",
  prompts: { persist: [], dynamic: [] },
  model: "provider:model",
};

function emptyRuleView() {
  return { rows: [] as const, displayByPath: new Map() };
}

function mockUserVfsTurn(
  overrides: {
    readonly flushPendingUserVfsTurns?: UserVfsTurnService["flushPendingUserVfsTurns"];
    readonly hasPendingTurns?: UserVfsTurnService["hasPendingTurns"];
  } = {},
): UserVfsTurnService {
  return {
    executeOp: async () => ({ ok: true }),
    flushPendingUserVfsTurns:
      overrides.flushPendingUserVfsTurns ??
      (async () => ({ flushed: false, attachments: [] })),
    previewUserOpsChangedPaths: async () => [],
    previewUserOpsActions: async () => [],
    hasPendingTurns: overrides.hasPendingTurns ?? (async () => false),
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
    opts?: { attachments?: readonly MessageAttachment[] },
  ) => Promise<{ id: string }>;
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
      listBySession: overrides.listBySession ?? (async () => []),
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
    sessionVfs: () => ({} as never),
    worktree: () =>
      ({
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ workplaceDisplay: "" }),
        evaluateRuleView: async () => emptyRuleView(),
      }) as ReturnType<AgentTurnRuntimePort["worktree"]>,
    sessionKkv: {
      get: async () => null,
      set: async () => undefined,
      listKeys: async () => [],
    } as AgentTurnRuntimePort["sessionKkv"],
    savedModelRepo: {
      getById: async () => null,
    } as AgentTurnRuntimePort["savedModelRepo"],
    userVfsTurn: overrides.userVfsTurn,
  } as AgentTurnRuntimePort;
}

describe("annotateDrafts send (T-AN3/T-AN4/T-AN6 core)", () => {
  it("T-AN4: hasComposerSendableInput({ hasAnnotateDrafts:true }) 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: false,
        hasAnnotateDrafts: true,
      }),
      true,
    );
  });

  it("T-AN4: 仅 annotateDrafts → hasInput/shouldAppend；禁空续跑删末条", async () => {
    refreshUserVfsUnifiedToolTurnSnapshot(true);
    const deleted: string[] = [];
    const appended: Array<{
      attachments?: readonly MessageAttachment[];
    }> = [];
    const trailingId = "u-trailing";
    const runtime = makeRuntime({
      listBySession: async () => [
        { id: trailingId, role: "user", content: { blocks: [] } },
      ],
      delete: async (id) => {
        deleted.push(id);
      },
      append: async (_s, _r, _c, opts) => {
        appended.push({ attachments: opts?.attachments });
        return { id: "u-new" };
      },
      userVfsTurn: mockUserVfsTurn({
        hasPendingTurns: async () => true,
        flushPendingUserVfsTurns: async () => ({
          flushed: true,
          attachments: [
            {
              name: "/p.md",
              source: "user_ops",
              type: "text",
              content: '<action name="write">\n{}\n</action>',
              path: "/p.md",
              action: "write",
            },
          ],
        }),
      }),
    });

    // stub runner：避免真实 LLM；runAgentTurn 在 append 后会进 runner
    // 通过 definitionOverride + 让 runner 早失败不方便；此处只验证 append 前编排
    // 使用 onUserMessageAppended + 在 runner 前抛错的方式不可行。
    // 改为：mock 到 append 后抛错——实际上 runAgentTurn 会继续 runner。
    // 最小：断言空 content + annotate 不抛「消息不能为空」，且 delete 未调用。
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p1", sessionId: "s1" },
        "",
        {
          allowResumeWithoutInput: true,
          annotateDrafts: [
            {
              id: "a1",
              path: "/note.md",
              originalText: "选区",
              userAnnotation: "说明",
            },
          ],
          definitionOverride: sampleDefinition,
          stream: false,
        },
      );
    } catch {
      // runner 缺依赖可能失败；门闩与 append 语义仍可检
    }

    assert.equal(deleted.length, 0, "有 annotateDrafts 时不得 delete 末条");
    assert.ok(appended.length >= 1, "须新 append");
    const atts = appended[0]!.attachments ?? [];
    assert.ok(atts.some((a) => a.action === "annotate"));
    assert.ok(atts.some((a) => a.action === "write"));

    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-AN3: append 成功后附件含 annotate action XML；回调可触发", async () => {
    refreshUserVfsUnifiedToolTurnSnapshot(true);
    let appendedAtts: readonly MessageAttachment[] | undefined;
    let callbackCount = 0;
    const runtime = makeRuntime({
      append: async (_s, _r, _c, opts) => {
        appendedAtts = opts?.attachments;
        return { id: "u1" };
      },
      userVfsTurn: mockUserVfsTurn(),
    });

    try {
      await runAgentTurn(
        runtime,
        { projectId: "p1", sessionId: "s1" },
        "hello",
        {
          annotateDrafts: [
            {
              id: "d1",
              path: "/c.md",
              originalText: "原文",
              userAnnotation: "批",
            },
          ],
          definitionOverride: sampleDefinition,
          stream: false,
          onUserMessageAppended: () => {
            callbackCount += 1;
          },
        },
      );
    } catch {
      // runner 可能失败
    }

    assert.ok(appendedAtts != null);
    const ann = appendedAtts!.filter((a) => a.action === "annotate");
    assert.equal(ann.length, 1);
    assert.equal(ann[0]!.name, "/c.md");
    assert.equal(ann[0]!.source, "user_ops");
    assert.match(ann[0]!.content ?? "", /name="annotate"/);
    assert.match(ann[0]!.content ?? "", /"originalText"/);
    assert.match(ann[0]!.content ?? "", /"userAnnotation"/);
    assert.equal(callbackCount, 1);

    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("T-AN6: 同 path 两条 annotate concat 进落库；禁 path 去重丢条", async () => {
    refreshUserVfsUnifiedToolTurnSnapshot(true);
    const drafts = [
      {
        id: "1",
        path: "/same.md",
        originalText: "a",
        userAnnotation: "一",
      },
      {
        id: "2",
        path: "/same.md",
        originalText: "b",
        userAnnotation: "二",
      },
    ];
    const annotateAtts = drafts.map(buildAnnotateAttachmentFromDraft);
    // 若误走 mergeAttachmentsByPath 会丢一条
    const wronglyMerged = mergeAttachmentsByPath([], annotateAtts);
    assert.equal(
      wronglyMerged.length,
      1,
      "对照：path 去重会静默丢条",
    );

    const concat = [...annotateAtts];
    assert.equal(concat.length, 2);
    const wrapped = wrapUserMessageForLlm("x", concat);
    const matches = wrapped.match(/name="annotate"/g) ?? [];
    assert.equal(matches.length, 2);
    assert.match(wrapped, /"userAnnotation": "一"/);
    assert.match(wrapped, /"userAnnotation": "二"/);

    // 打穿 runAgentTurn append：同 path 两条不得被 path 去重丢掉
    let appendedAtts: readonly MessageAttachment[] | undefined;
    const runtime = makeRuntime({
      append: async (_s, _r, _c, opts) => {
        appendedAtts = opts?.attachments;
        return { id: "u-an6" };
      },
      userVfsTurn: mockUserVfsTurn(),
    });
    try {
      await runAgentTurn(
        runtime,
        { projectId: "p1", sessionId: "s1" },
        "hello",
        {
          annotateDrafts: drafts,
          definitionOverride: sampleDefinition,
          stream: false,
        },
      );
    } catch {
      // runner 可能失败；append 语义仍可检
    }
    assert.ok(appendedAtts != null, "须走 append");
    const ann = (appendedAtts ?? []).filter((a) => a.action === "annotate");
    assert.equal(ann.length, 2, "同 path 两条 annotate 均须进 append attachments");
    assert.equal(ann[0]!.path, "/same.md");
    assert.equal(ann[1]!.path, "/same.md");
    assert.match(ann[0]!.content ?? "", /"userAnnotation": "一"/);
    assert.match(ann[1]!.content ?? "", /"userAnnotation": "二"/);

    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });

  it("无输入且无 annotate → 仍抛消息不能为空", async () => {
    refreshUserVfsUnifiedToolTurnSnapshot(true);
    const runtime = makeRuntime({ userVfsTurn: mockUserVfsTurn() });
    await assert.rejects(
      () =>
        runAgentTurn(
          runtime,
          { projectId: "p1", sessionId: "s1" },
          "  ",
          { definitionOverride: sampleDefinition, stream: false },
        ),
      (err: unknown) =>
        err instanceof AgentTurnError && err.message === "消息不能为空",
    );
    resetUserVfsUnifiedToolTurnSnapshotForTests();
  });
});
