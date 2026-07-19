import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
  type CreateAgentRunnerDeps,
  type BuiltinToolContext,
} from "@novel-master/core/agent";
import { textBlocks, TOOL_TURN_BRIDGE_TEXT } from "@novel-master/core/chat";
import { messageBodyText } from "@novel-master/core/prompt";
import {
  type LlmChatResult,
  type ModelRequestOptions,
  type ModelRequestService,
} from "@novel-master/core/provider";
import { SimpleEventBus } from "@novel-master/core/events";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import { type VfsService } from "@novel-master/core/vfs";
import {
  fileCacheKey,
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import {
  serializeFileCachePayload,
  serializeRuleSnapshot,
} from "../../src/domain/worktree/logic/rule-snapshot-codec.js";
import type { SessionKkvService } from "@novel-master/core/session-kkv";

const RUN_MODEL_ID = "anthropic/claude";
const PROJECT_ID = "p1";
const SESSION_ID = "s1";
const SNAPSHOT_BODY = "WORKTREE_SNAPSHOT";

function mockVfs(): VfsService {
  const files = new Map<string, string>();
  return {
    async read(path: string) {
      return { path, content: files.get(path) ?? "", version: 1, mtimeMs: 0 };
    },
    async write(path: string, content: string) {
      files.set(path, content);
      return { version: 1 };
    },
    async replace(path: string, oldString: string, newString: string) {
      const content = files.get(path) ?? "";
      files.set(path, content.replace(oldString, newString));
      return { version: 1, replacements: 1 };
    },
    async list() {
      return [...files.keys()];
    },
    async glob() {
      return [];
    },
    async grep() {
      return [];
    },
    async delete() {
      return { deleted: true };
    },
  } as unknown as VfsService;
}

function mockToolCtx(vfs: VfsService): BuiltinToolContext {
  return {
    vfs,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    listSessionMessages: async () => [],
  };
}

import { noopSavedModelRepository } from "../helpers/noop-saved-model-repo.js";

async function seedWorkplaceKkv(
  sessionKkv: SessionKkvService,
  body: string,
): Promise<void> {
  await sessionKkv.set(
    SESSION_ID,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY,
    serializeRuleSnapshot([{ path: "/snap.md", status: "full" }]),
  );
  await sessionKkv.set(
    SESSION_ID,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    fileCacheKey("full", "/snap.md"),
    serializeFileCachePayload({ body, mtimeMs: 1 }),
  );
}

function runnerDeps(
  deps: Omit<
    CreateAgentRunnerDeps,
    "eventBus" | "sessionKkv" | "worktree" | "savedModels"
  > &
    Partial<Pick<CreateAgentRunnerDeps, "savedModels" | "sessionKkv">>,
): CreateAgentRunnerDeps {
  return {
    savedModels: noopSavedModelRepository(),
    sessionKkv: createMemorySessionKkv(),
    ...deps,
    eventBus: new SimpleEventBus(),
    worktree: () =>
      ({
        scope: {
          kind: "session",
          projectId: PROJECT_ID,
          sessionId: SESSION_ID,
        },
        renderDisplay: async () => "",
        buildListRows: async () => [],
        materializePersistBlock: async () => ({ worktreeDisplay: "" }),
        evaluateRuleView: async () => ({
          rows: [],
          displayByPath: new Map(),
        }),
      } as never),
  };
}

describe("AgentRunner template blocks", () => {
  it("T-WT16: history 含 worktree 双消息 + 会话 user", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "ctx-agent",
      prompts: {
        persistEnabled: true,
        workplace: true,
        persist: [],
        dynamic: [],
      },
    };

    const sessionKkv = createMemorySessionKkv();
    await seedWorkplaceKkv(sessionKkv, SNAPSHOT_BODY);

    const captured: { options?: ModelRequestOptions } = {};
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        captured.options = options;
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry: new ToolRegistry(),
        toolCtx: mockToolCtx(mockVfs()),
        sessionKkv,
      }),
    );

    await runner.run({
      maxSteps: 1,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    const history = captured.options?.history ?? [];
    assert.equal(history.length, 3);
    assert.equal(history[0]!.id, "prompt:workplace");
    assert.match(messageBodyText(history[0]!), new RegExp(SNAPSHOT_BODY));
    assert.equal(history[1]!.id, "prompt:workplace:done");
    assert.equal(messageBodyText(history[1]!), TOOL_TURN_BRIDGE_TEXT);
    assert.equal(history[2]!.role, "user");
  });

  it("T-WT16 R3: 多步 history 均含 worktree 双消息", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("go"));

    const definition: AgentDefinition = {
      name: "ctx-agent",
      prompts: {
        persistEnabled: true,
        workplace: true,
        persist: [],
        dynamic: [],
      },
    };

    const sessionKkv = createMemorySessionKkv();
    await seedWorkplaceKkv(sessionKkv, SNAPSHOT_BODY);

    const histories: ModelRequestOptions[] = [];
    const model: ModelRequestService = {
      request: mock.fn(async (_modelId, _content, options) => {
        histories.push(options);
        if (histories.length < 2) {
          return {
            assistantText: "",
            blocks: [
              {
                type: "tool_use",
                id: "tu1",
                name: "write",
                input: { path: "/out.txt", content: "x" },
              },
            ],
            raw: {},
          } satisfies LlmChatResult;
        }
        return {
          assistantText: "ok",
          blocks: [{ type: "text", text: "ok" }],
          raw: {},
        } satisfies LlmChatResult;
      }),
    };

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const vfs = mockVfs();
    const runner = createAgentRunner(
      runnerDeps({
        session,
        modelRequests: model,
        registry,
        toolCtx: mockToolCtx(vfs),
        sessionKkv,
      }),
    );

    await runner.run({
      maxSteps: 3,
      definition,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(histories.length, 2);
    for (const opts of histories) {
      const history = opts.history ?? [];
      assert.equal(
        history.some((m) => m.id === "prompt:workplace"),
        true,
      );
      assert.equal(
        history.some((m) => m.id === "prompt:workplace:done"),
        true,
      );
      const ctxMsg = history.find((m) => m.id === "prompt:workplace");
      const doneMsg = history.find(
        (m) => m.id === "prompt:workplace:done",
      );
      assert.match(
        ctxMsg != null ? messageBodyText(ctxMsg) : "",
        new RegExp(SNAPSHOT_BODY),
      );
      assert.equal(
        doneMsg != null ? messageBodyText(doneMsg) : "",
        TOOL_TURN_BRIDGE_TEXT,
      );
    }
  });
});
