/**
 * skill-result-ref Step 6/7/8 定向测试（T-SR1~7）。
 *
 * 夹具用**真** SkillsService（global / project 两域各建技能文件，走真
 * meta 域 VFS 落 vfs_revision）——引用化的全部承重假设（技能与普通文件
 * 同表同版本链、head 三件套可定位、ref_count 第三类持有者语义）都必须
 * 在真链路上验证；mock service 拿不到 entryId，只能验形不能验数。
 *
 * 覆盖矩阵：
 * - T-SR1：skill read 引用化 round-trip——落库块 content=""、contentRef
 *   全字段、+1 已发生（ref_count 断言）、wire 逐字节等值（hydrate 重放 vs
 *   formatToolOutputForLlm 原文）；**outputSchema 牙齿**——输出经
 *   ToolRunner.call（safeParse strip 路径）后三件套仍在。
 * - T-SR1b：跨域同名（global / project 两域各建同名技能、内容不同）——
 *   缺省域命中 project 副本、显式 global 命中另一 entry，两次 hydrate
 *   各自等值。
 * - T-SR2：计数对账——read 后 edit 中间版本 sweep 保活；消息删除挂点 −1；
 *   同 turn 重复读偏差（登记为已知偏差：只增不减）。
 * - T-SR3：分页重放——offset/limit 多变体 wire 等值（skill 截断管线与 vfs
 *   read 管线的差异面）。
 * - T-SR4：skill load 引用化 round-trip——files 清单重放；alreadyReferenced
 *   形态仍走全文常量 tip、不产 ref。
 * - T-SR5：ZIP 导入重开 entry 后旧 contentRef 仍 hydrate 旧内容——**两条
 *   导入路径各跑一遍**（sweepRevisionsUnderScope / deleteVfsPrefix），断言
 *   不依赖具体实现形态（hydrate 只查 vfs_revision、不回读 vfs_entry）。
 * - T-SR6：技能删除后引用保活（sweepRevisionsUnderScope 路径）。
 * - T-SR7：技能改名（renamePrefix）后旧 ref 仍按 (entryId, version) hydrate。
 * - T-SR8：损坏引用的fail-fast——revision 行被裸删（悬空）抛
 *   READ_REF_REVISION_MISSING、contentHash 篡改成另一版本真实 hash 抛
 *   READ_REF_HASH_MISMATCH（断的是坏引用，好块仍须 hydrate 等值）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type {
  ContentBlock,
  SkillResultRef,
  ToolResultBlock,
} from "../../src/domain/chat/model/content-block.js";
import { parseMessageContent } from "../../src/domain/chat/content/parse-message-content.js";
import {
  hydrateToolResultsForPrompt,
  ReadResultHydrateError,
} from "../../src/domain/chat/logic/hydrate-tool-results-for-prompt.js";
import { buildToolResultBlock } from "../../src/domain/tool/logic/build-tool-result-block.js";
import { formatToolOutputForLlm } from "../../src/domain/tool/logic/format-tool-output.js";
import { ToolRegistry } from "../../src/domain/tool/logic/tool-registry.js";
import { ToolRunner } from "../../src/domain/tool/logic/tool-runner.js";
import { registerBuiltinTools } from "../../src/domain/tool/builtin/register-builtin-tools.js";
import { SKILL_TOOL_NAME } from "../../src/domain/tool/builtin/skill-tool.js";
import type { SkillToolOutput } from "../../src/domain/tool/builtin/skill-tool.js";
import type { BuiltinToolContext } from "../../src/domain/tool/builtin/builtin-tool-context.js";
import { SqliteVfsRevisionRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  deleteVfsPrefix,
  sweepRevisionsUnderScope,
} from "../../src/domain/vfs/logic/vfs-tree-copy.js";
import { SKILLS_ROOT } from "../../src/domain/skills/logic/skill-paths.js";
import { SkillsService } from "../../src/service/skills/impl/skills.service.js";
import { DefaultMessageTranscriptEffectsService } from "../../src/service/chat/impl/message-transcript-effects.service.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 一个项目的全套 skill 夹具（真 service + 真 meta 域 VFS + 工具 ctx）。 */
type SkillFixture = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly service: SkillsService;
  readonly revisionRepo: SqliteVfsRevisionRepository;
  readonly ctx: BuiltinToolContext;
  readonly runner: ToolRunner<BuiltinToolContext>;
};

/** 建真 SkillsService（global / project 两域 meta VFS 都接真库）。 */
function makeSkillFixture(): SkillFixture {
  const { conn, globalMetaVfs, projectMetaVfs } = getNovelMasterTestContext();
  const service = new SkillsService({ conn, globalMetaVfs, projectMetaVfs });
  return { service, revisionRepo: new SqliteVfsRevisionRepository(conn), ...makeToolCtx(conn, service) };
}

let fixtureCounter = 0;

/** 建一次工具侧夹具（项目 / 会话 / 带 +1 通道的 BuiltinToolContext / ToolRunner）。 */
function makeToolCtx(
  conn: TdbcConnection,
  service: SkillsService
): {
  readonly projectId: string;
  readonly sessionId: string;
  readonly ctx: BuiltinToolContext;
  readonly runner: ToolRunner<BuiltinToolContext>;
} {
  const { sessionVfs } = getNovelMasterTestContext();
  const suffix = testIsolationSuffix();
  const projectId = `pj-sr-${suffix}-${fixtureCounter++}`;
  const sessionId = `ss-sr-${suffix}-${fixtureCounter++}`;
  const revisionRepo = new SqliteVfsRevisionRepository(conn);
  const ctx: BuiltinToolContext = {
    vfs: sessionVfs(projectId, sessionId),
    projectId,
    sessionId,
    listSessionMessages: async () => [],
    // +1 通道：与生产装配同款（agent-runner 注入同一 revisionRepo 方法）。
    adjustRevisionRefCount: (pointers, delta) =>
      revisionRepo.batchAdjustRefCountWithDelta(pointers, delta),
    skills: { service, projectId, effective: [] },
  };
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return { projectId, sessionId, ctx, runner: new ToolRunner(registry) };
}

/**
 * 跑一次 skill 工具（经 ToolRunner.call，走 outputSchema safeParse 剥离
 * 路径——「zod 静默 strip 未声明键」牙齿正是在这里验）。
 */
async function callSkill(
  fx: SkillFixture,
  input: Record<string, unknown>,
  referencedNames?: Set<string>
): Promise<SkillToolOutput> {
  const ctx: BuiltinToolContext = {
    ...fx.ctx,
    skills: {
      service: fx.service,
      projectId: fx.projectId,
      effective: [],
      ...(referencedNames != null ? { referencedNames } : {}),
    },
  };
  return await fx.runner.call<SkillToolOutput>(SKILL_TOOL_NAME, input, ctx);
}

/** skill read 落块（contentRef 必产，否则断言即失败）。 */
function buildSkillBlock(toolUseId: string, output: SkillToolOutput): ToolResultBlock {
  const block = buildToolResultBlock(
    toolUseId,
    { ok: true, output },
    { toolName: SKILL_TOOL_NAME, skillProjectId: undefined }
  );
  assert.ok(block.contentRef != null, "skill read/load 成功路径必须产 contentRef 块");
  assert.equal(block.content, "", "引用态块 content 必须是占位空串");
  return block;
}

/** ref_count 点查；行不存在（已被 GC）返回 null。 */
async function refCountOf(entryId: number, version: number): Promise<number | null> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version]
  );
  return rows.length === 0 ? null : Number(rows[0]!.ref_count);
}

/** tool_result 引用块所在的 user 回传消息。 */
function refMessage(block: ToolResultBlock, id = "tr-sr"): ChatMessage {
  return {
    id,
    sessionId: "ss-sr-hydrate",
    seq: 2,
    role: "user",
    content: { blocks: [block] },
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

/** hydrate 后取回块 content（顺带断言 view-time 纪律：入参未被变异）。 */
async function hydrateContent(
  block: ToolResultBlock,
  revisionRepo: SqliteVfsRevisionRepository
): Promise<string> {
  const message = refMessage(block);
  const hydrated = await hydrateToolResultsForPrompt([message], revisionRepo);
  assert.equal(
    (message.content.blocks[0] as ToolResultBlock).content,
    "",
    "入参块不得被变异（view-time 纪律）"
  );
  const out = hydrated[0]!.content.blocks[0]!;
  assert.equal(out.type, "tool_result");
  if (out.type !== "tool_result") throw new Error("expected tool_result");
  assert.deepEqual(out.contentRef, block.contentRef, "contentRef 原样保留");
  return out.content;
}

/** 真链路 seed：一个 project 域技能（SKILL.md + 一个附属文件）。 */
async function seedProjectSkill(
  fx: SkillFixture,
  name: string,
  content: string
): Promise<void> {
  await fx.service.writeSkillFile(
    "project",
    name,
    undefined,
    content,
    fx.projectId
  );
  await fx.service.writeSkillFile(
    "project",
    name,
    "refs/helper.md",
    `辅助文件\n`,
    fx.projectId
  );
}

describe("skill-result-ref: T-SR1 skill read 引用化 round-trip", () => {
  it("落库块 content=\"\"、contentRef 全字段、+1 已发生、wire 逐字节等值", async () => {
    const fx = makeSkillFixture();
    await seedProjectSkill(fx, "sr1-skill", "行一\n行二\n行三");

    const output = await callSkill(fx, { action: "read", name: "sr1-skill" });
    assert.equal(output.action, "read");

    // **outputSchema 牙齿**：输出过了 ToolRunner 的 safeParse strip 路径，
    // 三件套仍在（不声明会被 zod 静默剥离 → 产块门拿不到 entryId →
    // 静默回落 legacy 全文、整块收益归零且无任何报错）。
    assert.ok(typeof output.entryId === "number", "safeParse 后 entryId 必须在");
    assert.ok(
      typeof output.contentHash === "string" && output.contentHash !== "",
      "safeParse 后 contentHash 必须在"
    );
    assert.equal(typeof output.totalBytes, "number");

    // +1 已发生：live head(1) + read(1) = 2。
    const version = output.version;
    const entryId = output.entryId!;
    assert.equal(await refCountOf(entryId, version), 2);

    const block = buildSkillBlock("tu-sr1", output);
    assert.equal(block.ok, true);
    assert.equal(block.content, "");
    assert.equal(block.summary, "3 lines");
    const ref = block.contentRef as SkillResultRef;
    assert.equal(ref.kind, "skill");
    assert.equal(ref.action, "read");
    assert.equal(ref.domain, "project");
    assert.equal(ref.name, "sr1-skill");
    assert.equal(ref.path, "SKILL.md");
    assert.equal(ref.entryId, entryId);
    assert.equal(ref.version, version);
    assert.equal(ref.contentHash, output.contentHash);
    assert.equal(ref.totalBytes, output.totalBytes);
    assert.equal(ref.offset, 1);
    assert.equal(ref.limit, 2000);
    assert.equal(ref.returnedLines, 3);
    assert.equal(ref.totalLines, 3);
    assert.equal(ref.truncated, false);
    assert.equal(ref.nextOffset, undefined);

    // contentRef 块过 parse round-trip 不丢字段（逐字段断言，白名单漏一项
    // 就静默丢字段——failureReason 已有丢失先例）。
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [block as ContentBlock] })
    );
    const roundTrip = parsed.blocks[0]!;
    if (roundTrip.type !== "tool_result") throw new Error("expected tool_result");
    assert.deepEqual(roundTrip.contentRef, ref);

    // wire 逐字节等值：基准 = 工具执行时的 formatToolOutputForLlm 原文。
    const baseline = formatToolOutputForLlm(output);
    assert.match(baseline, /     1\|行一/);
    assert.equal(await hydrateContent(block, fx.revisionRepo), baseline);
  });

  it("ctx 未注入 adjustRevisionRefCount 时不 +1、输出不带三件套（legacy 回落）", async () => {
    const fx = makeSkillFixture();
    await seedProjectSkill(fx, "sr1-legacy", "a\nb");
    const { conn } = getNovelMasterTestContext();
    const entryRows = await conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE path = ?`,
      [`/meta/skills/sr1-legacy/SKILL.md`]
    );
    const entryId = entryRows[0]!.entry_id;

    const ctx: BuiltinToolContext = {
      ...fx.ctx,
      // 故意不注入 adjustRevisionRefCount
      adjustRevisionRefCount: undefined,
    };
    const output = await fx.runner.call<SkillToolOutput>(
      SKILL_TOOL_NAME,
      { action: "read", name: "sr1-legacy" },
      ctx
    );
    assert.equal(output.entryId, undefined);
    assert.equal(output.contentHash, undefined);
    assert.equal(output.totalBytes, undefined);
    // live head 的 ref_count 未被 skill read 抬升。
    assert.equal(await refCountOf(entryId, output.version), 1);

    // 产块门走 legacy 全文（无 contentRef）。
    const block = buildToolResultBlock(
      "tu-sr1-legacy",
      { ok: true, output },
      { toolName: SKILL_TOOL_NAME }
    );
    assert.equal(block.contentRef, undefined);
    assert.ok(block.content.includes("1|a"));
  });
});

describe("skill-result-ref: T-SR1b 跨域同名（global / project 各一份）", () => {
  it("缺省域 read 命中 project 副本；显式 global 命中另一 entry，两次 hydrate 各自等值", async () => {
    const fx = makeSkillFixture();
    // 两域同名、内容不同（spec「两域夹具」的实现侧补齐）：缺省域必须按
    // 生效副本解析到 project 副本，显式 domain 则打另一条版本链。
    await fx.service.writeSkillFile(
      "global",
      "sr1b-dup",
      undefined,
      "global-第一行\nglobal-第二行"
    );
    await fx.service.writeSkillFile(
      "project",
      "sr1b-dup",
      undefined,
      "project-第一行\nproject-第二行",
      fx.projectId
    );

    const byDefault = await callSkill(fx, { action: "read", name: "sr1b-dup" });
    assert.equal(byDefault.domain, "project", "缺省域按生效副本解析（项目副本优先）");
    const defaultBlock = buildSkillBlock("tu-sr1b-project", byDefault);
    const defaultRef = defaultBlock.contentRef as SkillResultRef;
    assert.equal(defaultRef.domain, "project");

    const byGlobal = await callSkill(fx, {
      action: "read",
      name: "sr1b-dup",
      domain: "global",
    });
    assert.equal(byGlobal.domain, "global", "显式域必须打 global 本体");
    const globalBlock = buildSkillBlock("tu-sr1b-global", byGlobal);
    const globalRef = globalBlock.contentRef as SkillResultRef;
    assert.equal(globalRef.domain, "global");
    assert.equal(globalRef.name, defaultRef.name, "同名：name 相同不构成同一引用");

    // 两域同名 = 两条独立 entry（引用键是 (entryId, version)，不是 name）。
    assert.notEqual(defaultRef.entryId, globalRef.entryId, "跨域同名必须落到不同 entry");
    // 两条 wire 各自带自己那份正文，不串味。
    const projectWire = formatToolOutputForLlm(byDefault);
    const globalWire = formatToolOutputForLlm(byGlobal);
    assert.match(projectWire, /project-第一行/);
    assert.match(globalWire, /global-第一行/);
    assert.equal(await hydrateContent(defaultBlock, fx.revisionRepo), projectWire);
    assert.equal(await hydrateContent(globalBlock, fx.revisionRepo), globalWire);
  });
});

describe("skill-result-ref: T-SR2 计数对账", () => {
  it("read 后 skill edit 产生中间版本：被引用版本 sweep 保活，hydrate 仍正常", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr2-${testIsolationSuffix()}`);
    // 会话 ctx 用真项目 id（skill service 走 project-meta 域，需要真 projectId）
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr2-skill", "v1-第一行");

    const output = await callSkill(fixture, { action: "read", name: "sr2-skill" });
    const entryId = output.entryId!;
    const version = output.version;
    assert.equal(await refCountOf(entryId, version), 2);
    const block = buildSkillBlock("tu-sr2", output);
    const baseline = formatToolOutputForLlm(output);

    // skill edit 产生 v2：v1 失去 live head 持有（−1），只剩 read 引用 → 1。
    await fixture.service.editSkillFile(
      "project",
      "sr2-skill",
      undefined,
      { oldString: "v1-第一行", newString: "v2-第二行" },
      fixture.projectId
    );
    assert.equal(
      await refCountOf(entryId, version),
      1,
      "被 skill read 引用的历史版本必须保留 1 份引用"
    );

    // sweep（技能删除会走的同款原语）不得误删被引用版本。
    await ctxT.conn.transaction(async (tx) => {
      await sweepRevisionsUnderScope(
        new SqliteVfsEntryRepository(tx),
        new SqliteVfsRevisionRepository(tx),
        `project:${fixture.projectId}:meta`,
        `${SKILLS_ROOT}/sr2-skill-other`
      );
    });
    assert.notEqual(await refCountOf(entryId, version), null, "被引用版本不得被 sweep 回收");

    // 引用块 hydrate 仍逐字节等值（内容是 v1 那一版，不是当前 head）。
    assert.equal(await hydrateContent(block, fx.revisionRepo), baseline);
  });

  it("消息删除挂点对 SkillResultRef 的 −1 生效（collectReadRefs 含 skill ref）", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr2b-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr2b-skill", "x\ny");

    const output = await callSkill(fixture, { action: "read", name: "sr2b-skill" });
    const entryId = output.entryId!;
    const version = output.version;
    const block = buildSkillBlock("tu-sr2b", output);
    assert.equal(await refCountOf(entryId, version), 2);

    const msg = await ctxT.messages.append(session.id, "assistant", {
      blocks: [block as ContentBlock],
    });
    await ctxT.messages.delete(msg.id);
    assert.equal(
      await refCountOf(entryId, version),
      1,
      "删除持引用消息后 −1 生效（live head 的 1 份留下）"
    );
  });

  it("同 turn 重复读偏差：+1 按调用两次、删除侧按消息内去重一次 → 净值 ≥0 且只增不减", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr2c-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr2c-skill", "dup\nline");

    // 同一文件读两次（skill 场景更易触发：load 后再 read / 探索式重读）。
    const first = await callSkill(fixture, { action: "read", name: "sr2c-skill" });
    const second = await callSkill(fixture, { action: "read", name: "sr2c-skill" });
    assert.equal(first.entryId, second.entryId);
    assert.equal(first.version, second.version);
    const entryId = first.entryId!;
    const version = first.version;
    // live head(1) + read ×2 = 3
    assert.equal(await refCountOf(entryId, version), 3);

    const b1 = buildSkillBlock("tu-sr2c-1", first);
    const b2 = buildSkillBlock("tu-sr2c-2", second);
    const msg = await ctxT.messages.append(session.id, "assistant", {
      blocks: [b1 as ContentBlock, b2 as ContentBlock],
    });
    await ctxT.messages.delete(msg.id);
    // collectReadRefs 按消息内 (entryId, version) 去重 → 只 −1。
    const after = (await refCountOf(entryId, version))!;
    // 已知偏差（与 read-ref 分支既有决议同口径）：不误删数据（净值 ≥0），
    // 方向为「只增不减」——残留的 +1 阻碍 sweep 回收，由 repair 检测兜底。
    assert.ok(after >= 1, `删除后 ref_count 不得为负（实际 ${after}）`);
    assert.equal(after, 2, "偏差方向固定：残留 1 份 +1（3 → 2，不回落到 1）");
  });
});

describe("skill-result-ref: T-SR3 分页重放", () => {
  it("offset/limit 多变体 wire 逐字节等值（含行数帽截断的 nextOffset）", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr3-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    const lines = Array.from({ length: 12 }, (_, i) => `第${i + 1}行`);
    await seedProjectSkill(fixture, "sr3-skill", lines.join("\n"));

    const variants: Array<{ offset?: number; limit?: number }> = [
      {},
      { offset: 3 },
      { offset: 3, limit: 4 },
      { limit: 5 },
      { offset: 12 },
      { offset: 11, limit: 5 },
    ];
    for (const [i, variant] of variants.entries()) {
      const output = await callSkill(fixture, {
        action: "read",
        name: "sr3-skill",
        ...variant,
      });
      if (output.action !== "read") throw new Error("expected read output");
      const block = buildSkillBlock(`tu-sr3-${i}`, output);
      const baseline = formatToolOutputForLlm(output);
      assert.equal(
        await hydrateContent(block, fx.revisionRepo),
        baseline,
        `变体 ${JSON.stringify(variant)} 的 hydrate 重放必须逐字节等值`
      );
      const ref = block.contentRef as SkillResultRef;
      assert.equal(ref.offset, variant.offset ?? 1);
      assert.equal(ref.limit, variant.limit ?? 2000);
      assert.equal(ref.truncated, output.truncated);
      assert.equal(ref.nextOffset, output.nextOffset);
    }
  });

  it("超长单行（skill 的 truncateLine 管线面）：wire 等值", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr3b-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    // 单行 3000 字符 → skill 的 truncateLine 截到 2000 字符 + 尾注，
    // 与 vfs read 的 capUtf8BytesFill 管线**不同**（这正是单源抽取的原因）。
    await seedProjectSkill(fixture, "sr3b-skill", "长".repeat(3000));
    const output = await callSkill(fixture, { action: "read", name: "sr3b-skill" });
    const block = buildSkillBlock("tu-sr3b", output);
    const baseline = formatToolOutputForLlm(output);
    assert.match(baseline, /line truncated to 2000 chars/);
    assert.equal(await hydrateContent(block, fx.revisionRepo), baseline);
  });
});

describe("skill-result-ref: T-SR4 skill load 引用化 round-trip", () => {
  it("load 引用化：files 清单随 ref 重放，wire 逐字节等值", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr4-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr4-skill", "技能正文第一行\n技能正文第二行");

    const output = await callSkill(fixture, { action: "load", name: "sr4-skill" });
    if (output.action !== "load") throw new Error("expected load output");
    assert.ok(typeof output.entryId === "number", "load 输出也要带三件套");
    assert.deepEqual([...output.files], ["refs/helper.md"]);
    assert.equal(await refCountOf(output.entryId, output.version), 2);

    const block = buildSkillBlock("tu-sr4", output);
    const ref = block.contentRef as SkillResultRef;
    assert.equal(ref.kind, "skill");
    assert.equal(ref.action, "load");
    assert.equal(ref.truncated, false);
    assert.deepEqual(ref.files, ["refs/helper.md"]);

    // 二次 round-trip 逐字节稳定（files 不丢）。
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [block as ContentBlock] })
    );
    const rt = parsed.blocks[0]!;
    if (rt.type !== "tool_result") throw new Error("expected tool_result");
    assert.deepEqual(rt.contentRef, ref);

    // wire 逐字节等值——含「附属文件」尾注（依赖 ref 里的 files）。
    const baseline = formatToolOutputForLlm(output);
    assert.match(baseline, /附属文件（相对技能目录）：refs\/helper\.md/);
    assert.equal(await hydrateContent(block, fx.revisionRepo), baseline);
  });

  it("alreadyReferenced 形态仍走全文常量 tip、不 +1、不产 ref", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr4b-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr4b-skill", "正文");

    const output = await callSkill(
      fixture,
      { action: "load", name: "sr4b-skill" },
      new Set(["sr4b-skill"])
    );
    if (output.action !== "load") throw new Error("expected load output");
    assert.equal(output.alreadyReferenced, true);
    assert.equal(output.entryId, undefined, "已注入过全文的形态不产引用锚");
    // live head 的 ref_count 不被抬升。
    const entryRows = await ctxT.conn.query<{ entry_id: number }>(
      `SELECT entry_id FROM vfs_entry WHERE path = ?`,
      [`/meta/skills/sr4b-skill/SKILL.md`]
    );
    assert.equal(
      await refCountOf(entryRows[0]!.entry_id, output.version),
      1
    );

    // 产块门走 legacy 全文（tip 本身即全文）。
    const block = buildToolResultBlock(
      "tu-sr4b",
      { ok: true, output },
      { toolName: SKILL_TOOL_NAME }
    );
    assert.equal(block.contentRef, undefined);
    assert.match(block.content, /已在本请求提示词中/);
  });
});

describe("skill-result-ref: T-SR5 ZIP 导入重开 entry 后旧 ref 仍可定位", () => {
  /**
   * 导入替换的实现形态有两种（`sweepRevisionsUnderScope` 扣 live 后按
   * ref_count 回收 / 仅 `deleteVfsPrefix` 删 entry 行让旧 revision 泄漏
   * 存活）。断言**不依赖具体形态**：(entryId, version) 定位与 hydrate
   * 两条路径天然满足——两条各跑一遍钉死。
   */
  for (const mode of ["sweep", "prefixDelete"] as const) {
    it(`${mode} 路径：重开 entry 后旧 contentRef 仍 hydrate 旧内容`, async () => {
      const fx = makeSkillFixture();
      const ctxT = getNovelMasterTestContext();
      const project = await ctxT.projects.create(
        `P-sr5-${mode}-${testIsolationSuffix()}`
      );
      const session = await ctxT.sessions.create(project.id);
      const fixture: SkillFixture = {
        ...fx,
        projectId: project.id,
        sessionId: session.id,
        ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
      };
      await seedProjectSkill(fixture, "sr5-skill", "导入前旧内容\n第二行");

      const output = await callSkill(fixture, { action: "read", name: "sr5-skill" });
      const oldEntryId = output.entryId!;
      const oldVersion = output.version;
      const block = buildSkillBlock(`tu-sr5-${mode}`, output);
      const oldBaseline = formatToolOutputForLlm(output);

      // 「导入」= 该技能目录被整体替换（entry 行删除 + 同路径重开新 entry）。
      await ctxT.conn.transaction(async (tx) => {
        const entryRepo = new SqliteVfsEntryRepository(tx);
        const revisionRepo = new SqliteVfsRevisionRepository(tx);
        const scopeKey = `project:${fixture.projectId}:meta`;
        if (mode === "sweep") {
          await sweepRevisionsUnderScope(
            entryRepo,
            revisionRepo,
            scopeKey,
            `${SKILLS_ROOT}/sr5-skill`
          );
        } else {
          await deleteVfsPrefix(
            entryRepo,
            scopeKey,
            `${SKILLS_ROOT}/sr5-skill`
          );
        }
      });
      // 同路径重新种入（entry_id 重开为新值）。
      await seedProjectSkill(fixture, "sr5-skill", "导入后新内容");
      const entryRows = await ctxT.conn.query<{ entry_id: number }>(
        `SELECT entry_id FROM vfs_entry WHERE path = ?`,
        [`/meta/skills/sr5-skill/SKILL.md`]
      );
      const newEntryId = entryRows[0]!.entry_id;
      assert.notEqual(newEntryId, oldEntryId, "导入后应是新 entry（旧 entry 已被删）");

      // 旧 ref 仍按 (oldEntryId, oldVersion) hydrate 出**旧内容**（sweep 路径
      // 下旧 revision 靠 read 的 +1 保活）。
      assert.equal(await hydrateContent(block, fx.revisionRepo), oldBaseline);
      assert.ok(
        (await refCountOf(oldEntryId, oldVersion)) != null,
        "被引用的旧 revision 必须存活"
      );
    });
  }
});

describe("skill-result-ref: T-SR6 技能删除后引用保活", () => {
  it("deleteSkill（sweepRevisionsUnderScope 路径）：ref_count>0 存活、hydrate 正常", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr6-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr6-skill", "删除前的技能正文\n第二行");

    const output = await callSkill(fixture, { action: "read", name: "sr6-skill" });
    const entryId = output.entryId!;
    const version = output.version;
    const block = buildSkillBlock("tu-sr6", output);
    const baseline = formatToolOutputForLlm(output);
    assert.equal(await refCountOf(entryId, version), 2);

    await fixture.service.deleteSkill({
      domain: "project",
      projectId: fixture.projectId,
      name: "sr6-skill",
    });

    // live head −1 后只剩 read 引用 → 存活。
    assert.equal(await refCountOf(entryId, version), 1);
    assert.equal(await hydrateContent(block, fx.revisionRepo), baseline);
  });
});

describe("skill-result-ref: T-SR7 技能改名后引用定位", () => {
  it("updateSkillInfo（renamePrefix）后旧 ref 仍按 (entryId, version) hydrate 且 wire 等值", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr7-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr7-old", "改名前的正文\n第二行");

    const output = await callSkill(fixture, { action: "read", name: "sr7-old" });
    const entryId = output.entryId!;
    const version = output.version;
    const block = buildSkillBlock("tu-sr7", output);
    const baseline = formatToolOutputForLlm(output);

    await fixture.service.updateSkillInfo(
      { domain: "project", projectId: fixture.projectId, name: "sr7-old" },
      { newName: "sr7-new" }
    );

    // renamePrefix 是单事务 path REPLACE、entry_id 保留——旧 ref 的
    // (entryId, version) 键不受影响（path 本就只是展示用）。
    const afterRows = await ctxT.conn.query<{ entry_id: number; path: string }>(
      `SELECT entry_id, path FROM vfs_entry WHERE path LIKE ?`,
      [`/meta/skills/sr7-%`]
    );
    const skillFileRows = afterRows.filter(
      (r) => r.path.endsWith("SKILL.md") || r.path.endsWith("helper.md")
    );
    assert.equal(skillFileRows.length, 2, "两个技能文件行都在（目录行不计入）");
    assert.equal(
      skillFileRows.find((r) => r.path.endsWith("SKILL.md"))!.entry_id,
      entryId,
      "改名走 renamePrefix：SKILL.md 的 entry_id 保留（引用键不受影响）"
    );
    assert.ok(
      skillFileRows.every((r) => r.path.includes("sr7-new")),
      "改名后文件路径已迁到新目录"
    );
    assert.ok(
      afterRows.every((r) => !r.path.includes("sr7-old")),
      "旧目录路径不得残留"
    );

    assert.equal(await refCountOf(entryId, version), 2, "live head 仍持有（entry_id 保留）");
    assert.equal(await hydrateContent(block, fx.revisionRepo), baseline);
  });
});

describe("skill-result-ref: 截断删尾挂点对 skill ref 生效", () => {
  it("truncateMessagesAfter：被删尾消息的 skill ref −1 先于 sweep", async () => {
    const fx = makeSkillFixture();
    const ctxT = getNovelMasterTestContext();
    const project = await ctxT.projects.create(`P-sr8-${testIsolationSuffix()}`);
    const session = await ctxT.sessions.create(project.id);
    const fixture: SkillFixture = {
      ...fx,
      projectId: project.id,
      sessionId: session.id,
      ctx: { ...fx.ctx, projectId: project.id, sessionId: session.id },
    };
    await seedProjectSkill(fixture, "sr8-skill", "tail-引用正文");

    const output = await callSkill(fixture, { action: "read", name: "sr8-skill" });
    const entryId = output.entryId!;
    const version = output.version;
    const block = buildSkillBlock("tu-sr8", output);
    assert.equal(await refCountOf(entryId, version), 2);

    await ctxT.messages.append(session.id, "user", {
      blocks: [{ type: "text", text: "保活锚点" } as ContentBlock],
    });
    await ctxT.messages.append(session.id, "assistant", {
      blocks: [block as ContentBlock],
    });

    const effects = new DefaultMessageTranscriptEffectsService({
      conn: ctxT.conn,
      messages: ctxT.messages,
      sessionKkv: ctxT.sessionKkv,
    });
    await effects.truncateMessagesAfter(project.id, session.id, 1, {
      sweepRevisions: true,
    });

    // −1 先于 sweep：删掉的引用不再保活（本例 live head 仍持有 → 剩 1）。
    assert.equal(await refCountOf(entryId, version), 1);
  });
});

describe("skill-result-ref: T-SR8 悬空 / 篡改 fail-fast", () => {
  it("revision 行被裸删（绕过保活链）：hydrate 抛 READ_REF_REVISION_MISSING", async () => {
    const fx = makeSkillFixture();
    await seedProjectSkill(fx, "sr8-dangling", "悬空正文\n第二行");
    const output = await callSkill(fx, { action: "read", name: "sr8-dangling" });
    const block = buildSkillBlock("tu-sr8-dangling", output);
    assert.equal(await refCountOf(output.entryId!, output.version), 2);

    // 裸 DELETE（绕过 ref_count）：模拟保活链被破坏——引用块仍在消息里，
    // 目标 revision 却不复存在。这正是引用化最危险的一种损坏：静默放行等于
    // 给 LLM 发一个空 tool_result。
    const { conn } = getNovelMasterTestContext();
    await conn.execute(
      `DELETE FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [output.entryId!, output.version]
    );
    assert.equal(await refCountOf(output.entryId!, output.version), null);

    await assert.rejects(
      () => hydrateToolResultsForPrompt([refMessage(block)], fx.revisionRepo),
      (err: unknown) => {
        assert.ok(
          err instanceof ReadResultHydrateError,
          `期望 ReadResultHydrateError，实际 ${String(err)}`
        );
        assert.equal(err.code, "READ_REF_REVISION_MISSING");
        // 断言只锁「这是一条 skill read 引用」这层语义，**不锁 locKey 字面量**
        //（open question ⑨ 若改 locKey 格式，当前形如 `read:SKILL.md`，本用例
        // 不连带改）。
        assert.match(err.message, /skill read 引用/);
        return true;
      }
    );
  });

  it("contentRef.contentHash 被改成另一版本的真实 hash：抛 READ_REF_HASH_MISMATCH", async () => {
    const fx = makeSkillFixture();
    await seedProjectSkill(fx, "sr8-tampered", "v1-原正文");
    const output = await callSkill(fx, { action: "read", name: "sr8-tampered" });
    const entryId = output.entryId!;
    const version = output.version;
    const block = buildSkillBlock("tu-sr8-tampered", output);

    // 篡改值取**另一版本的真实 hash**（不是随手编的假串）：这才是现实中会
    // 发生的形态（引用错键 / 版本错位——行上的 content_hash 指向另一版明文）。
    await fx.service.editSkillFile(
      "project",
      "sr8-tampered",
      undefined,
      { oldString: "v1-原正文", newString: "v2-另一版正文" },
      fx.projectId
    );
    const { conn } = getNovelMasterTestContext();
    const otherRows = await conn.query<{ content_hash: string }>(
      `SELECT content_hash FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [entryId, version + 1]
    );
    assert.equal(otherRows.length, 1, "第二版必须存在（edit 走同entry 版本链）");
    const otherHash = otherRows[0]!.content_hash;
    assert.notEqual(otherHash, output.contentHash, "两版 hash 必须不同，否则本用例空转");

    const tampered: ToolResultBlock = {
      ...block,
      contentRef: {
        ...(block.contentRef as SkillResultRef),
        contentHash: otherHash,
      },
    };
    await assert.rejects(
      () => hydrateToolResultsForPrompt([refMessage(tampered)], fx.revisionRepo),
      (err: unknown) => {
        assert.ok(
          err instanceof ReadResultHydrateError,
          `期望 ReadResultHydrateError，实际 ${String(err)}`
        );
        assert.equal(err.code, "READ_REF_HASH_MISMATCH");
        assert.match(err.message, /skill read 引用/);
        return true;
      }
    );
    // 反向确认：篡改只影响那条坏引用，好块仍 hydrate 等值（本用例没把库/装配
    // 弄成全局坏掉）。
    assert.equal(
      await hydrateContent(block, fx.revisionRepo),
      formatToolOutputForLlm(output)
    );
  });
});