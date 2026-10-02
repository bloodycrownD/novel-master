/**
 * read 结果进提示词的两态断言（task-attach-unref Step 4，T-RR10）。
 *
 * v1.5.29 时此处验的是「引用形态与 legacy 全文形态逐字节 parity」。v1.5.30
 * unref 回迁后该口径按 spec D16 **撤除**——兜底 hydrate 填的是 revision
 * 明文 JSON 包，与 legacy wire（行号前缀 / 截断提示 / 分页切片）本就
 * 不等值，强行对齐才是 bug。改为两态断言：
 *
 * - **新写行**：wire = 全文直出（`formatToolOutputForLlm` 的带行号全文），
 *   全程不经 hydrate（块上根本没有 contentRef）。
 * - **存量行**：构造 v1.5.29 引用块 → prepare 兜底 hydrate → 提示词里是
 *   `{path, content}` JSON 包形态。
 *
 * 两态都过同一条 parity 出口（`serializePromptLlmInput` → 内部
 * `messageBodyTextFromBlocks`）与 LLM 主链共用 prepare，故 token 估算 /
 * 压缩阈值判定（字符口径）在两态下都携带真实正文，不被占位空串污染。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type {
  ReadResultRef,
  ToolResultBlock,
} from "../../src/domain/chat/model/content-block.js";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { messageBodyTextFromBlocks } from "../../src/domain/chat/content/message-body-text.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { serializePromptLlmInput } from "../../src/infra/tokenizer/logic/serialize-prompt-input.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import type { ReadToolOutput } from "../../src/domain/tool/builtin/vfs-tools.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** role=user 的 tool_result 回传消息。 */
function toolResultMessage(
  block: ToolResultBlock,
  sessionId: string
): ChatMessage {
  return {
    id: "tr-rr10",
    sessionId,
    seq: 2,
    role: "user",
    content: { blocks: [block] },
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

const EMPTY_LAYOUT: AgentPromptLayout = { persist: [], dynamic: [] };

/** 真链路 read（写侧全文直出，块上无 contentRef）。 */
async function readViaTool(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string
): Promise<{ block: ToolResultBlock; output: ReadToolOutput }> {
  const vfs = ctx.sessionVfs(projectId, sessionId);
  const toolCtx: BuiltinToolContext = {
    vfs,
    projectId,
    sessionId,
    listSessionMessages: async () => [],
  };
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const runner = new ToolRunner(registry);
  const output = await runner.call<ReadToolOutput>("read", { path }, toolCtx);
  const block = buildToolResultBlock(
    toolUseId,
    { ok: true, output },
    { toolName: "read" }
  );
  assert.equal(block.contentRef, undefined, "新写行不得产 contentRef");
  return { block, output };
}

/** 构造 v1.5.29 存量引用块（content 空串 + contentRef 全字段）。 */
async function legacyRefBlock(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string
): Promise<ToolResultBlock> {
  await ctx.sessionVfs(projectId, sessionId).write(
    path,
    "legacy-第一行\nlegacy-第二行"
  );
  const entryRows = await ctx.conn.query<{ entry_id: number }>(
    `SELECT entry_id FROM vfs_entry WHERE path = ?`,
    [path]
  );
  const entryId = entryRows[0]!.entry_id;
  const revRows = await ctx.conn.query<{ content_hash: string }>(
    `SELECT content_hash FROM vfs_revision WHERE entry_id = ? AND version = 1`,
    [entryId]
  );
  const ref: ReadResultRef = {
    path,
    entryId,
    version: 1,
    contentHash: revRows[0]!.content_hash,
    totalBytes: 30,
    offset: 1,
    limit: 2000,
    returnedLines: 2,
    totalLines: 2,
    truncated: false,
  };
  return {
    type: "tool_result",
    toolUseId,
    content: "",
    ok: true,
    summary: "2 lines",
    contentRef: ref,
  };
}

describe("read-ref-prompt-parity: T-RR10 提示词两态（D16 撤除逐字节 parity）", () => {
  it("新写行：wire = 带行号全文直出，全程不经 hydrate", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-rr10-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    // 足够长的内容：让「全文 vs 空串」的字符数差异足以翻转任意紧阈值。
    const lines = Array.from(
      { length: 120 },
      (_, i) => `parity-line-${String(i).padStart(3, "0")}`
    );
    await vfs.write("/parity.md", lines.join("\n"));

    const { block } = await readViaTool(
      ctx,
      project.id,
      session.id,
      "/parity.md",
      "tu-rr10"
    );
    // 态一：块的正文本身就是 wire（无引用、无占位）。
    assert.equal(block.contentRef, undefined);
    assert.ok(block.content.includes("     1|parity-line-000"));
    assert.ok(block.content.length > 1000, "全文直出基线足够长");

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const sk = createSessionKkvService(ctx.conn);
    const prepared = await prepareUserMessagesForPrompt(
      [toolResultMessage(block, session.id)],
      { sessionId: session.id, sessionKkv: sk, vfs, revisionRepo }
    );
    // prepare 不改动无引用块（hydrate 零处理）。
    const outBlock = prepared[0]!.content.blocks[0] as ToolResultBlock;
    assert.equal(outBlock.content, block.content);
    assert.equal(outBlock.contentRef, undefined);

    const serial = await serializePromptLlmInput(EMPTY_LAYOUT, {
      workplaceDisplay: "",
      messages: prepared,
    });
    assert.ok(
      serial.includes("     1|parity-line-000"),
      "提示词串含带行号全文（行号格式不被兜底 JSON 包替换）"
    );
    assert.equal(
      serial.includes('"path"'),
      false,
      "新写行不得被 hydrate 成 JSON 包形态"
    );
    const bodyText = messageBodyTextFromBlocks(prepared[0]!.content.blocks);
    assert.ok(bodyText.length > 1000, "字符口径携带全文（阈值判定不失真）");
  });

  it("存量行：prepare 兜底 hydrate 后 = {path, content} JSON 包形态", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-rr10b-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const block = await legacyRefBlock(
      ctx,
      project.id,
      session.id,
      "/parity-b.md",
      "tu-rr10b"
    );

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const sk = createSessionKkvService(ctx.conn);
    const prepared = await prepareUserMessagesForPrompt(
      [toolResultMessage(block, session.id)],
      { sessionId: session.id, sessionKkv: sk, vfs, revisionRepo }
    );
    const outBlock = prepared[0]!.content.blocks[0] as ToolResultBlock;
    // 态二：JSON 包（含 revision 明文），不是 legacy wire。
    assert.deepEqual(JSON.parse(outBlock.content), {
      path: "/parity-b.md",
      content: "legacy-第一行\nlegacy-第二行",
    });
    assert.equal(
      outBlock.content.includes("     1|legacy-第一行"),
      false,
      "兜底包不带行号前缀（与 legacy wire 不逐字节等值是预期，D16）"
    );

    const serial = await serializePromptLlmInput(EMPTY_LAYOUT, {
      workplaceDisplay: "",
      messages: prepared,
    });
    assert.ok(serial.includes("/parity-b.md"), "提示词串携带定位路径");
    assert.ok(serial.includes("legacy-第一行"), "提示词串携带真实正文");
    assert.ok(
      messageBodyTextFromBlocks(prepared[0]!.content.blocks).includes(
        "legacy-第二行"
      ),
      "字符口径携带正文"
    );
  });

  it("对照组：未 hydrate 的存量引用块只剩 [tool_result id=…] 头——证明 hydrate 是两态共同的前提", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-rr10c-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const block = await legacyRefBlock(
      ctx,
      project.id,
      session.id,
      "/parity-c.md",
      "tu-rr10c"
    );

    // 不经 prepare 直接取 bodyText（模拟「装配缺口 / 跳过 hydrate」的错链）：
    // 引用块只剩头——正文丢失，阈值判定会失真。
    const raw = messageBodyTextFromBlocks([block]);
    assert.equal(
      raw.includes("legacy-第一行"),
      false,
      "未 hydrate 的引用块不含正文"
    );
    assert.match(raw, /\[tool_result id=tu-rr10c\]/);
  });
});
