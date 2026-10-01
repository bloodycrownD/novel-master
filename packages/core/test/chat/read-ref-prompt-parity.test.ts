/**
 * read-tool-result-ref Step 6：T-RR10 压缩 / token 口径 parity。
 *
 * parity 链（`serializePromptLlmInput` → `formatPromptLlmInputForCliFromLayout`
 * → 内部 messageBodyTextFromBlocks）与 LLM 主链共用 prepare——引用块经
 * hydrate 还原全文后，**同一内容的引用形态与 legacy 全文形态产出的序列化
 * 字符串逐字节一致**：token 估算 / 压缩条件评估（字符阈值判定）不受引用化
 * 影响。对照组（跳过 prepare 直接序列化引用块）证明 hydrate 是 parity 的
 * 前提——不 hydrate 的引用块会把全文悄悄缩水成占位空串，阈值判定失真。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { ToolResultBlock } from "../../src/domain/chat/model/content-block.js";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { messageBodyTextFromBlocks } from "../../src/domain/chat/content/message-body-text.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { formatToolOutputForLlm } from "../../src/domain/tool/logic/format-tool-output.js";
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
function toolResultMessage(block: ToolResultBlock, sessionId: string): ChatMessage {
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

/**
 * 真链路 read（+1 通道走 revisionRepo）：返回引用态块与原始输出——
 * legacy 对照块由同一输出重放 formatToolOutputForLlm（与旧形态落块同源）。
 */
async function readViaTool(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
  projectId: string,
  sessionId: string,
  path: string,
  toolUseId: string,
  revisionRepo: SqliteVfsRevisionRepository
): Promise<{ block: ToolResultBlock; output: ReadToolOutput }> {
  const vfs = ctx.sessionVfs(projectId, sessionId);
  const toolCtx: BuiltinToolContext = {
    vfs,
    projectId,
    sessionId,
    adjustRevisionRefCount: async (pointers, delta) => {
      await revisionRepo.batchAdjustRefCountWithDelta(pointers, delta);
    },
  };
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  const runner = new ToolRunner(registry);
  const output = await runner.call<ReadToolOutput>("read", { path }, toolCtx);
  assert.ok(output.entryId != null, "真链路 read 输出必须带 entryId");
  const block = buildToolResultBlock(
    toolUseId,
    { ok: true, output },
    { toolName: "read" }
  );
  assert.ok(block.contentRef != null);
  return { block, output };
}

describe("read-tool-result-ref Step 6: T-RR10 压缩/token 口径 parity", () => {
  it("引用形态与 legacy 全文形态：prepare 后 parity 串逐字节一致（阈值判定不受影响）", async () => {
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

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const { block: refBlock, output } = await readViaTool(
      ctx,
      project.id,
      session.id,
      "/parity.md",
      "tu-rr10",
      revisionRepo
    );

    // legacy 全文形态对照块：同一次 read 的输出直存全文（旧形态——无
    // contentRef，content 为 formatReadOutput 全文，与落块时同源格式化）。
    const legacyBlock: ToolResultBlock = {
      ...refBlock,
      contentRef: undefined,
      content: formatToolOutputForLlm(output),
    };
    assert.ok(legacyBlock.content.length > 1000, "legacy 全文形态基线充分长");

    const sk = createSessionKkvService(ctx.conn);
    /** 单一 parity 口：prepare（hydrate）→ serializePromptLlmInput。 */
    const paritySerial = async (block: ToolResultBlock): Promise<string> => {
      const prepared = await prepareUserMessagesForPrompt(
        [toolResultMessage(block, session.id)],
        { sessionId: session.id, sessionKkv: sk, vfs, revisionRepo }
      );
      return serializePromptLlmInput(EMPTY_LAYOUT, {
        workplaceDisplay: "",
        messages: prepared,
      });
    };

    const legacySerial = await paritySerial(legacyBlock);
    const refSerial = await paritySerial(refBlock);

    assert.equal(refSerial, legacySerial, "引用形态与全文形态 parity 串全等");
    assert.ok(
      legacySerial.includes("     1|parity-line-000"),
      "parity 串必须含 wire 全文（行号格式）"
    );

    // 字符口径（messageBodyTextFromBlocks）一致 → 字符阈值判定（压缩条件）
    // 不受影响；hydrate 后的引用形态携带全文而非占位空串。
    const bodyTextOf = async (block: ToolResultBlock): Promise<string> => {
      const prepared = await prepareUserMessagesForPrompt(
        [toolResultMessage(block, session.id)],
        { sessionId: session.id, sessionKkv: sk, vfs, revisionRepo }
      );
      return messageBodyTextFromBlocks(prepared[0]!.content.blocks);
    };
    const legacyText = await bodyTextOf(legacyBlock);
    const refText = await bodyTextOf(refBlock);
    assert.equal(refText, legacyText);
    assert.ok(refText.length > 1000, "hydrate 后 bodyText 携带全文");
  });

  it("对照组：跳过 prepare（不 hydrate）的引用块 bodyText 缺失全文——证明 hydrate 是 parity 前提", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`pj-rr10c-${suffix}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/parity-c.md", "c1\nc2\nc3");

    const revisionRepo = new SqliteVfsRevisionRepository(ctx.conn);
    const { block: refBlock } = await readViaTool(
      ctx,
      project.id,
      session.id,
      "/parity-c.md",
      "tu-rr10c",
      revisionRepo
    );

    // 不经 prepare 直接取 bodyText（模拟「装配缺口 / 跳过 hydrate」的错链）：
    // 引用块只剩 [tool_result id=…] 头——全文丢失，阈值判定会失真。
    const raw = messageBodyTextFromBlocks([refBlock]);
    assert.ok(!raw.includes("c1|"), "未 hydrate 的引用块不含全文");
    assert.match(raw, /\[tool_result id=tu-rr10c\]/);
  });
});
