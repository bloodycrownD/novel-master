/**
 * Agent run 内 VFS write：不走已退役的 BlockStore.capture；write 可 upsert file_cache。
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createAgentRunner,
  InMemoryAgentSession,
  type AgentDefinition,
} from "@novel-master/core/agent";
import { textBlocks } from "@novel-master/core/chat";
import { SimpleEventBus } from "@novel-master/core/events";
import {
  registerBuiltinTools,
  ToolRegistry,
  type BuiltinToolContext,
} from "@novel-master/core";
import {
  type LlmChatResult,
  type ModelRequestService,
} from "@novel-master/core/provider";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "@novel-master/core/session-kkv";
import { type VfsService } from "@novel-master/core/vfs";
import { createMemorySessionKkv } from "../../helpers/prompt-layout-test-helpers.js";
import { noopSavedModelRepository } from "../../helpers/noop-saved-model-repo.js";

const MOCK_PROJECT_ID = "test-project";
const MOCK_SESSION_ID = "test-session";
const RUN_MODEL_ID = "anthropic/claude";

function minimalDefinition(): AgentDefinition {
  return {
    name: "test",
    prompts: { persist: [], dynamic: [] },
  };
}

function mockVfs(): VfsService {
  const files = new Map<string, string>();
  return {
    async read(path: string) {
      const content = files.get(path) ?? "";
      return { path, content, version: 1, mtimeMs: 0 };
    },
    async write(path: string, content: string) {
      files.set(path, content);
      return { version: 1 };
    },
    async replace(path: string, oldString: string, newString: string) {
      const c = files.get(path) ?? "";
      files.set(path, c.replace(oldString, newString));
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

function mockToolCtx(
  vfs: VfsService,
  sessionKkv: ReturnType<typeof createMemorySessionKkv>,
): BuiltinToolContext {
  return {
    vfs,
    projectId: MOCK_PROJECT_ID,
    sessionId: MOCK_SESSION_ID,
    listSessionMessages: async () => [],
    sessionKkv,
  };
}

function createMockModel(
  responses: LlmChatResult[],
): ModelRequestService & { callCount: () => number } {
  let calls = 0;
  return {
    callCount: () => calls,
    request: mock.fn(async () => {
      const r = responses[calls];
      calls += 1;
      if (r == null) {
        throw new Error("Unexpected extra model request");
      }
      return r;
    }),
  };
}

describe("AgentRunner workplace assemble (retire capture)", () => {
  it("T-WEC9: Agent run 内 VFS write 不调 materialize；可 upsert file_cache", async () => {
    const session = new InMemoryAgentSession();
    await session.append("user", textBlocks("write file"));

    const sessionKkv = createMemorySessionKkv();
    await sessionKkv.set(
      MOCK_SESSION_ID,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      "canon",
      "[]",
    );

    const vfs = mockVfs();
    const materializePersistBlock = mock.fn(async () => ({
      workplaceDisplay: "would-change-if-recaptured",
    }));

    const model = createMockModel([
      {
        assistantText: "",
        blocks: [
          {
            type: "tool_use",
            id: "w1",
            name: "write",
            input: { path: "/out.txt", content: "mutated" },
          },
        ],
        raw: {},
      },
      {
        assistantText: "done",
        blocks: [{ type: "text", text: "done" }],
        raw: {},
      },
    ]);

    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    const runner = createAgentRunner({
      session,
      modelRequests: model,
      registry,
      toolCtx: mockToolCtx(vfs, sessionKkv),
      eventBus: new SimpleEventBus(),
      sessionKkv,
      savedModels: noopSavedModelRepository(),
      workplace: () =>
        ({
          scope: {
            kind: "session",
            projectId: MOCK_PROJECT_ID,
            sessionId: MOCK_SESSION_ID,
          },
          renderDisplay: async () => "WT",
          buildListRows: async () => [],
          materializePersistBlock,
        }) as never,
    });

    await runner.run({
      maxSteps: 3,
      definition: minimalDefinition(),
      sessionId: MOCK_SESSION_ID,
      projectId: MOCK_PROJECT_ID,
      savedModelId: RUN_MODEL_ID,
      workspaceModelId: RUN_MODEL_ID,
    });

    assert.equal(materializePersistBlock.mock.callCount(), 0);
    assert.equal((await vfs.read("/out.txt")).content, "mutated");
    const cacheKeys = await sessionKkv.listKeys(
      MOCK_SESSION_ID,
      SESSION_KKV_DOMAIN_FILE_CACHE,
    );
    assert.ok(
      cacheKeys.some((k) => k.includes("/out.txt")),
      `write 应 upsert file_cache，实际 keys=${JSON.stringify(cacheKeys)}`,
    );
  });
});
