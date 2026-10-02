/**
 * task 工具两个新参数的单测（task-attach-unref Step 9 + Step 11 + ui-prompt-fixes R2）。
 *
 * - T-TS1/TS2/TS5：`sessionId` 续用——不新建 / 三态文案 / 历史软闸 / 非 NOT_FOUND 故障原样上抛；
 * - T-TA1/TA2/TA3：`fileAttachment`——合规物化形态 / 提示词全文 / 全量挂载 / 路径校验。
 *
 * 预算与降级已收敛到 prepare 链（core 单源），派发侧不再有任何条数 / 字符闸：
 * 超限附件照挂（附件落库事实不变 → chip 可见），降级只发生在提示词产物侧（T-A6）。
 *
 * 这里的 `runChildAgent` 是 mock（只观测收到的 opts），并发硬互斥（D5）与
 * 子会话落库的真实链路由 `test/service/agent/subagent-task-session-attach.test.ts`
 * 走 runAgentTurn 完整路径覆盖。
 *
 * @module test/tool/subagent-tool-session-file
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import {
  attachmentStorageName,
  messageAttachmentsSchema,
} from "@/domain/chat/model/message-attachment.schema.js";
import {
  subagentTool,
  TASK_SESSION_RESUME_MAX_MESSAGES,
} from "@/domain/tool/builtin/subagent-tool.js";
import type {
  BuiltinToolContext,
  BuiltinToolSubagentContext,
  RunChildAgentOptions,
} from "@/domain/tool/builtin/builtin-tool-context.js";
import { ToolError } from "@/errors/tool-errors.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { SessionService } from "@/service/chat/session.port.js";
import type { ChatSession } from "@/domain/chat/model/session.js";
import { textBlocks } from "@novel-master/core/chat";
import { messageBodyText } from "@/domain/chat/content/message-body-text.js";
import { ATTACH_PROMPT_CHAR_BUDGET } from "@/domain/chat/logic/attach-budget.js";
import { prepareUserMessagesForPrompt } from "@/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const generalDef: AgentDefinition = {
  name: "general",
  prompts: { persist: [], dynamic: [] },
};

const PARENT_ID = "parent-1";
const PROJECT_ID = "proj-1";

interface MockOpts {
  /** 已知子会话（id → 会话对象）。`sessions.get` 命中它，未命中抛 NOT_FOUND。 */
  readonly sessions?: readonly ChatSession[];
  /** 各子会话已有的历史消息条数（用于 D7 软闸）。 */
  readonly messageCounts?: Readonly<Record<string, number>>;
  /** `isSessionRunActive` 返回 true 的会话 id 集合。 */
  readonly activeSessions?: readonly string[];
  /** 直接父会话 id（默认 PARENT_ID）。 */
  readonly parentSessionId?: string;
  /**
   * `sessions.get` 抛的**非 NOT_FOUND** 错误（DB 故障模拟）。
   * 给了之后 `get` 一律抛它——用来钉「非 not-found 故障原样上抛」（B-3）。
   */
  readonly getThrows?: Error;
}

interface MockResult {
  readonly ctx: BuiltinToolSubagentContext;
  readonly createdSessions: { readonly id: string; readonly title: string }[];
  readonly capturedOpts: RunChildAgentOptions[];
  readonly capturedSessionIds: string[];
}

function chatErrorNotFound(): Error {
  const err = new Error(`session not found`) as Error & { code?: string };
  err.code = "NOT_FOUND";
  return err;
}

function makeSubagent(opts: MockOpts = {}): MockResult {
  const createdSessions: { id: string; title: string }[] = [];
  const capturedOpts: RunChildAgentOptions[] = [];
  const capturedSessionIds: string[] = [];
  const known = new Map<string, ChatSession>();
  for (const s of opts.sessions ?? []) {
    known.set(s.id, s);
  }
  const active = new Set(opts.activeSessions ?? []);
  const counts = opts.messageCounts ?? {};
  let counter = 0;

  const agentRegistry: AgentRegistryService = {
    listAgentIds: async () => ["id-1"],
    list: async () => [generalDef],
    get: async () => generalDef,
    getRawWire: async () => null,
    upsert: async () => undefined,
    delete: async () => undefined,
  };

  const messages: MessageService = {
    listBySession: async (sessionId: string) => {
      const n = counts[sessionId] ?? 0;
      return Array.from({ length: n }, (_, i) => ({
        role: "user",
        content: { blocks: [{ type: "text", text: `m${i}` }] },
      })) as unknown as ChatMessage[];
    },
    // repo-mega-cr Wave C 的 subagent 窄读消费口（src 端已切换，mock 缺方法
    // 会 TypeError——「加方法先扫手写假实现」同族坑；实现抄
    // subagent-tool-parallel.test.ts 的范本：role 过滤 + 末 limit 条）。
    listBySessionTailOfRole: async (sessionId: string, options: {role: string; limit: number}) => {
      const n = counts[sessionId] ?? 0;
      const all = Array.from({ length: n }, (_, i) => ({
        role: "user",
        content: { blocks: [{ type: "text", text: `m${i}` }] },
      })) as unknown as ChatMessage[];
      return all
        .filter((m) => m.role === options.role)
        .slice(-Math.max(1, Math.floor(options.limit)));
    },
  } as unknown as MessageService;

  const sessions: SessionService = {
    get: async (id: string) => {
      if (opts.getThrows != null) throw opts.getThrows;
      const s = known.get(id);
      if (s == null) throw chatErrorNotFound();
      return s;
    },
    createSubSession: async (
      parentSessionId: string,
      projectId: string,
      title?: string | null
    ) => {
      counter += 1;
      const id = `child-${counter}`;
      createdSessions.push({ id, title: title ?? "" });
      const session: ChatSession = {
        id,
        projectId,
        title: title ?? null,
        parentSessionId,
        createdAtMs: 0,
        updatedAtMs: 0,
      };
      known.set(id, session);
      return session;
    },
  } as unknown as SessionService;

  const ctx: BuiltinToolSubagentContext = {
    agentRegistry,
    messages,
    sessions,
    depth: 0,
    callableAgents: [{ name: "general" }],
    parentSignal: new AbortController().signal,
    createChildSession: async (title: string) => {
      const s = await sessions.createSubSession(PARENT_ID, PROJECT_ID, title);
      return s.id;
    },
    parentSessionId: opts.parentSessionId ?? PARENT_ID,
    isSessionRunActive: (id: string) => active.has(id),
    resolveChildModelId: (def) => ({
      savedModelId: def.model ?? "parent-saved",
      workspaceModelId: "ws-model",
    }),
    runChildAgent: async (def, childSessionId, runOpts) => {
      capturedSessionIds.push(childSessionId);
      capturedOpts.push(runOpts);
      return {
        stepsExecuted: 1,
        finished: true,
        stopReason: "completed" as const,
        rounds: [],
      };
    },
  };

  return { ctx, createdSessions, capturedOpts, capturedSessionIds };
}

function toolCtx(subagent: BuiltinToolSubagentContext): BuiltinToolContext {
  return {
    vfs: {} as never,
    projectId: PROJECT_ID,
    sessionId: PARENT_ID,
    listSessionMessages: async () => [],
    subagent,
  };
}

/** 造一个「属于 PARENT_ID 的既有子会话」。 */
function childSession(
  id: string,
  overrides?: Partial<ChatSession>
): ChatSession {
  return {
    id,
    projectId: PROJECT_ID,
    title: "既有子会话",
    parentSessionId: PARENT_ID,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides,
  };
}

describe("task sessionId 续用（T-TS*）", () => {
  it("T-TS1: 非空 sessionId 不新建子会话，runChildAgent 收到同一 id，回流 subagentSessionId 同 id", async () => {
    const { ctx, createdSessions, capturedSessionIds } = makeSubagent({
      sessions: [childSession("kid-1")],
    });
    const out = await subagentTool.run(
      {
        description: "续做",
        prompt: "接着上一步继续",
        subagentName: "general",
        sessionId: "  kid-1  ",
      },
      toolCtx(ctx)
    );
    assert.equal(createdSessions.length, 0, "续用不得新建子会话");
    assert.deepEqual(capturedSessionIds, ["kid-1"], "runChildAgent 必须收到同一 id");
    assert.equal(out.subagentSessionId, "kid-1");
  });

  it("T-TS1b: 缺省 / 空串 / 纯空白 sessionId 一律新开（模型显式传空串等价于不传）", async () => {
    for (const sessionId of [undefined, "", "   "]) {
      const { ctx, createdSessions } = makeSubagent();
      await subagentTool.run(
        { description: "新任务", prompt: "p", subagentName: "general", sessionId },
        toolCtx(ctx)
      );
      assert.equal(createdSessions.length, 1, `sessionId=${JSON.stringify(sessionId)} 应新开`);
    }
  });

  it("T-TS1c: 续用时 prompt 照常透传给 runChildAgent（子会话首条 user 消息由它落库）", async () => {
    const { ctx, capturedOpts } = makeSubagent({
      sessions: [childSession("kid-1")],
    });
    await subagentTool.run(
      {
        description: "续做",
        prompt: "第二轮的任务正文",
        subagentName: "general",
        sessionId: "kid-1",
      },
      toolCtx(ctx)
    );
    assert.equal(capturedOpts[0]!.prompt, "第二轮的任务正文");
  });

  it("T-TS2a: 子会话不存在 → ToolError FAILED，文案引导去掉 sessionId 新开", async () => {
    const { ctx, createdSessions } = makeSubagent({ sessions: [] });
    await assert.rejects(
      () =>
        subagentTool.run(
          { description: "d", prompt: "p", subagentName: "general", sessionId: "ghost" },
          toolCtx(ctx)
        ),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal(e.code, "FAILED");
        assert.match(e.message, /找不到子会话/);
        assert.match(e.message, /去掉 sessionId/);
        return true;
      }
    );
    assert.equal(createdSessions.length, 0);
  });

  it("T-TS2a2: sessions.get 抛非 NOT_FOUND 故障 → 原样上抛，且不新建子会话", async () => {
    // 瞬时 DB 抖动若被吞成「找不到子会话」，模型会误判 sessionId 失效 → 新建重复子会话。
    const dbFault = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    const { ctx, createdSessions, capturedSessionIds } = makeSubagent({
      sessions: [childSession("kid-1")],
      getThrows: dbFault,
    });
    await assert.rejects(
      () =>
        subagentTool.run(
          {
            description: "d",
            prompt: "p",
            subagentName: "general",
            sessionId: "kid-1",
          },
          toolCtx(ctx)
        ),
      (e: unknown) => {
        assert.equal(e, dbFault, "必须原样上抛，不能被改写成 ToolError");
        return true;
      }
    );
    assert.equal(createdSessions.length, 0, "故障时不得降级新建");
    assert.equal(capturedSessionIds.length, 0, "故障时不得进 runChildAgent");
  });

  it("T-TS2b: 存在但不是当前会话的子会话（parentSessionId 不符）→ 拒绝", async () => {
    const { ctx } = makeSubagent({
      sessions: [childSession("other-kid", { parentSessionId: "别的父会话" })],
    });
    await assert.rejects(
      () =>
        subagentTool.run(
          {
            description: "d",
            prompt: "p",
            subagentName: "general",
            sessionId: "other-kid",
          },
          toolCtx(ctx)
        ),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.equal(e.code, "FAILED");
        assert.match(e.message, /不是当前会话派生的子会话/);
        assert.match(e.message, /去掉 sessionId/);
        return true;
      }
    );
  });

  it("T-TS2c: 跨 project 的会话同样被拒（父 id 不同即拒，一条判定覆盖）", async () => {
    const { ctx } = makeSubagent({
      sessions: [
        childSession("x-kid", {
          parentSessionId: PARENT_ID,
          projectId: "别的项目",
        }),
      ],
    });
    // 父 id 相同但项目不同：口径上仍按「直接父」判定通过——归属校验的锚是父会话，
    // 而父会话唯一决定 project。这里把断言落在真正会被拒的形态上：
    const { ctx: ctx2 } = makeSubagent({
      sessions: [childSession("y-kid", { parentSessionId: "别的父" })],
    });
    await assert.rejects(
      () =>
        subagentTool.run(
          {
            description: "d",
            prompt: "p",
            subagentName: "general",
            sessionId: "y-kid",
          },
          toolCtx(ctx2)
        ),
      (e: unknown) => e instanceof ToolError && /不是当前会话派生的子会话/.test(e.message)
    );
    // 反向：项目不同但父相同 → 放行（子代理本就共享父工作区，不按 project 拦）。
    const out = await subagentTool.run(
      {
        description: "d",
        prompt: "p",
        subagentName: "general",
        sessionId: "x-kid",
      },
      toolCtx(ctx)
    );
    assert.equal(out.subagentSessionId, "x-kid");
  });

  it("T-TS2d: 子会话活跃中 → 软闸拒绝并引导新开", async () => {
    const { ctx, capturedSessionIds } = makeSubagent({
      sessions: [childSession("busy-kid")],
      activeSessions: ["busy-kid"],
    });
    await assert.rejects(
      () =>
        subagentTool.run(
          {
            description: "d",
            prompt: "p",
            subagentName: "general",
            sessionId: "busy-kid",
          },
          toolCtx(ctx)
        ),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.match(e.message, /正在运行中/);
        assert.match(e.message, /去掉 sessionId/);
        return true;
      }
    );
    assert.equal(capturedSessionIds.length, 0, "软闸命中不得进 runChildAgent");
  });

  it("T-TS2e: 缺 abortRegistry 时闭包保守拒绝（`?? true` 不放行续用）", async () => {
    // 模拟生产装配语义：runtime.abortRegistry 为 undefined 时 has 闭包返回 true。
    const { ctx: base } = makeSubagent({ sessions: [childSession("kid-1")] });
    const ctx: BuiltinToolSubagentContext = {
      ...base,
      isSessionRunActive: () => (undefined as unknown as boolean) ?? true,
    };
    await assert.rejects(
      () =>
        subagentTool.run(
          {
            description: "d",
            prompt: "p",
            subagentName: "general",
            sessionId: "kid-1",
          },
          toolCtx(ctx)
        ),
      (e: unknown) => e instanceof ToolError && /正在运行中/.test(e.message)
    );
  });

  it("T-TS5: 历史软闸——消息数超限拒绝续用并引导新开；未超限照常放行", async () => {
    const atLimit = makeSubagent({
      sessions: [childSession("kid-max")],
      messageCounts: { "kid-max": TASK_SESSION_RESUME_MAX_MESSAGES },
    });
    const okOut = await subagentTool.run(
      {
        description: "d",
        prompt: "p",
        subagentName: "general",
        sessionId: "kid-max",
      },
      toolCtx(atLimit.ctx)
    );
    assert.equal(okOut.subagentSessionId, "kid-max", "恰好等于上限应放行");

    const overLimit = makeSubagent({
      sessions: [childSession("kid-over")],
      messageCounts: { "kid-over": TASK_SESSION_RESUME_MAX_MESSAGES + 1 },
    });
    await assert.rejects(
      () =>
        subagentTool.run(
          {
            description: "d",
            prompt: "p",
            subagentName: "general",
            sessionId: "kid-over",
          },
          toolCtx(overLimit.ctx)
        ),
      (e: unknown) => {
        assert.ok(e instanceof ToolError);
        assert.match(e.message, /已有 \d+ 条消息/);
        assert.match(e.message, /去掉 sessionId/);
        return true;
      }
    );
    assert.equal(overLimit.capturedSessionIds.length, 0);
  });
});

describe("task fileAttachment 物化与预算（T-TA*）", () => {
  it("T-TA1: 预算内路径物化为合规新写入附件（name=storageName / userAttach / content:null / attach），且过落库硬 parse", async () => {
    const { ctx, capturedOpts } = makeSubagent({});
    await subagentTool.run(
      {
        description: "读设定",
        prompt: "看这两份",
        subagentName: "general",
        fileAttachment: ["notes/a.md", "notes/b.md"],
      },
      toolCtx(ctx)
    );
    const atts = capturedOpts[0]!.attachments!;
    assert.equal(atts.length, 2);
    for (const [i, path] of ["/notes/a.md", "/notes/b.md"].entries()) {
      const a = atts[i]!;
      assert.equal(a.path, path);
      // 牙齿：name 必须等于 attachmentStorageName(path)，写成 basename 会被 zod refine 拒绝
      assert.equal(a.name, attachmentStorageName(a.path));
      assert.notEqual(a.name, "a.md");
      assert.equal(a.action, "userAttach");
      assert.equal(a.content, null);
      assert.equal(a.source, "attach");
    }
    // 落库走 parse（非 safeParse）：这份形态必须一次通过。
    assert.doesNotThrow(() => messageAttachmentsSchema.parse(atts));
    // 反向牙齿：basename name 必被拒。
    assert.throws(() =>
      messageAttachmentsSchema.parse([{ ...atts[0]!, name: "a.md" }])
    );
  });

  it("T-TA1b: 重复路径去重（相对写法与带前导 / 同形），去重发生在分配名额之前", async () => {
    const { ctx, capturedOpts } = makeSubagent({});
    await subagentTool.run(
      {
        description: "读设定",
        prompt: "p",
        subagentName: "general",
        fileAttachment: ["notes/a.md", "/notes/a.md", "notes/a.md"],
      },
      toolCtx(ctx)
    );
    assert.equal(capturedOpts[0]!.attachments!.length, 1, "同形路径只占一个名额");
  });

  it("T-TA1c: 未传 fileAttachment 时不注入 attachments 键（老调用方零变化）", async () => {
    const { ctx, capturedOpts } = makeSubagent({});
    await subagentTool.run(
      { description: "d", prompt: "p", subagentName: "general" },
      toolCtx(ctx)
    );
    assert.equal(capturedOpts[0]!.attachments, undefined);
  });

  it("T-TA2: 附件全量挂载、prompt 原文不加尾注（体积预算由子会话 prepare 链负责，见 T-A 组）", async () => {
    const { ctx, capturedOpts } = makeSubagent({});
    await subagentTool.run(
      {
        description: "d",
        prompt: "原始正文",
        subagentName: "general",
        fileAttachment: ["notes/a.md"],
      },
      toolCtx(ctx)
    );
    assert.equal(capturedOpts[0]!.prompt, "原始正文", "派发侧不再拼尾注");
    assert.equal(capturedOpts[0]!.attachments!.length, 1);
  });

  it("T-TA3g: 续用 + fileAttachment 同时给：附件挂到同一条续用消息上", async () => {
    const { ctx, capturedOpts, capturedSessionIds } = makeSubagent({
      sessions: [childSession("kid-1")],
    });
    await subagentTool.run(
      {
        description: "d",
        prompt: "正文",
        subagentName: "general",
        sessionId: "kid-1",
        fileAttachment: ["a.md"],
      },
      toolCtx(ctx)
    );
    assert.deepEqual(capturedSessionIds, ["kid-1"]);
    assert.equal(capturedOpts[0]!.attachments!.length, 1);
  });

  it("T-TA3e: 空串 / 纯空白路径元素 → ToolError FAILED（不静默丢），且不得留下孤儿子会话", async () => {
    for (const bad of ["", "   "]) {
      const { ctx, createdSessions } = makeSubagent({});
      await assert.rejects(
        () =>
          subagentTool.run(
            {
              description: "d",
              prompt: "p",
              subagentName: "general",
              fileAttachment: ["good.md", bad],
            },
            toolCtx(ctx)
          ),
        (e: unknown) => {
          assert.ok(e instanceof ToolError, `路径 ${JSON.stringify(bad)} 应抛 ToolError`);
          assert.equal(e.code, "FAILED");
          assert.match(e.message, /fileAttachment 路径非法/);
          return true;
        }
      );
      // 牙齿：物化排在 createChildSession 之前。若留在之后，模型拿不到
      // subagentSessionId、子会话零消息又删不掉，重试还会再堆一个。
      assert.equal(
        createdSessions.length,
        0,
        `路径 ${JSON.stringify(bad)} 非法时不得新建子会话`
      );
    }
  });

  it("T-TA3e2: 路径穿越写法 `/../evil` → ToolError 文案带 fileAttachment 引导（不漏裸 VfsError）", async () => {
    const { ctx, createdSessions } = makeSubagent({});
    await assert.rejects(
      () =>
        subagentTool.run(
          {
            description: "d",
            prompt: "p",
            subagentName: "general",
            fileAttachment: ["/../evil"],
          },
          toolCtx(ctx)
        ),
      (e: unknown) => {
        assert.ok(e instanceof ToolError, "路径非法必须是 ToolError，不是裸 VfsError");
        assert.equal(e.code, "FAILED");
        assert.match(e.message, /fileAttachment 路径非法/);
        // 原 message 保留（VfsError 的中文/英文 reason 仍在文案里）
        assert.match(e.message, /Invalid path/);
        return true;
      }
    );
    assert.equal(createdSessions.length, 0, "同样不得新建子会话");
  });

  it("T-TA3i: 20+ 条附件全量挂载（条数上限退役）且 prompt 无尾注", async () => {
    const paths = Array.from({ length: 25 }, (_, i) => `f${i}.md`);
    const { ctx, capturedOpts } = makeSubagent({});
    await subagentTool.run(
      {
        description: "d",
        prompt: "正文",
        subagentName: "general",
        fileAttachment: paths,
      },
      toolCtx(ctx)
    );
    assert.equal(
      capturedOpts[0]!.attachments!.length,
      25,
      "派发侧不再有条数上限——预算统一由 prepare 链做"
    );
    assert.equal(capturedOpts[0]!.prompt, "正文", "派发侧不再拼尾注");
  });

  it("T-A6: 超限附件照挂（落库事实不变 → chip 可见），降级只发生在子会话 prepare 侧", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/huge.md", "H".repeat(ATTACH_PROMPT_CHAR_BUDGET + 1));

    // 派发侧：照挂，不筛、不加尾注
    const { ctx: subCtx, capturedOpts } = makeSubagent({});
    await subagentTool.run(
      {
        description: "d",
        prompt: "正文",
        subagentName: "general",
        fileAttachment: ["huge.md"],
      },
      toolCtx(subCtx)
    );
    const attached = capturedOpts[0]!.attachments!;
    assert.equal(attached.length, 1, "超预算附件也照挂");
    assert.equal(attached[0]!.path, "/huge.md");
    assert.equal(capturedOpts[0]!.prompt, "正文", "派发侧无尾注");

    // 子会话侧：prepare 降级（同一份附件形态），但 attachments 数组里那条仍在
    // ——附件落库事实不因提示词降级而消失，UI 附件组（chip）照常渲染。
    const childMsg: ChatMessage = {
      id: "c1",
      sessionId: session.id,
      seq: 1,
      role: "user",
      content: textBlocks("正文"),
      provider: null,
      raw: null,
      createdAtMs: 0,
      hidden: false,
      attachments: attached,
    };
    const prepared = await prepareUserMessagesForPrompt(
      [childMsg],
      {
        sessionId: session.id,
        sessionKkv: createSessionKkvService(ctx.conn),
        vfs,
      },
    );
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /文件过长，可用 read 配合 offset\/limit 分段读取/);
    assert.match(body, /"display": "filename"/);
    assert.equal(body.includes("1|HHHH"), false);
    // 落库侧附件仍在（chip 可见）：降级只改 content，不改附件条目
    const hydrated = prepared[0]!.attachments!;
    assert.equal(hydrated.length, 1);
    assert.equal(hydrated[0]!.path, "/huge.md");
    assert.match(hydrated[0]!.content ?? "", /文件过长/);
  });
});
