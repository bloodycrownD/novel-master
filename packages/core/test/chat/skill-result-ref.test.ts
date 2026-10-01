/**
 * skill 结果的两态定向测试（task-attach-unref Step 4）。
 *
 * v1.5.30 起 skill 引用化退役：写侧恒全文直出（load / read 都走
 * `formatToolOutputForLlm`），不再产 `contentRef`、不再 `+1` revision
 * ref_count、输出不再带 `entryId` / `contentHash` / `totalBytes`。但
 * v1.5.29 装机窗口写入的**存量 skill 引用行**仍在库里，提示词链路上只剩
 * 兜底 hydrate 一件事。故本文件分两态：
 *
 * - **态一 · 全文直出**：真 SkillsService 夹具（global / project 两域各建
 *   技能文件、走真 meta 域 VFS 落 vfs_revision）跑 load / read，断言块正文
 *   是带行号全文、无 contentRef、ref_count 不被抬升、三件套不在输出里。
 * - **态二 · 兜底 hydrate 存量行**：手工构造 `kind: "skill"` 的存量引用块，
 *   hydrate 回填 `{path, content}` JSON 包（`files` 等派生字段弃置）；取不到
 *   明文 → 错误占位 + warn；存量行在技能删除 / 改名 / ZIP 导入重开 entry /
 *   删尾截断下仍按 `(entryId, version)` 定位与对账。
 *
 * 废除的旧口径（失去被测对象）：三套 wire 逐字节等值重放（read / skill read
 * / skill load）、hash fail-fast、`+1` 计数对账、ctx 未注入通道的 legacy 回落。
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
import { hydrateToolResultsForPrompt } from "../../src/domain/chat/logic/hydrate-tool-results-for-prompt.js";
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
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

let fixtureCounter = 0;

/** 一个项目的全套 skill 夹具（真 service + 真 meta 域 VFS + 工具 ctx）。 */
type SkillFixture = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly service: SkillsService;
  readonly revisionRepo: SqliteVfsRevisionRepository;
  readonly ctx: BuiltinToolContext;
  readonly runner: ToolRunner<BuiltinToolContext>;
};

/** 建真 SkillsService（global / project 两域 meta VFS 都接真库）+ 真项目/会话。 */
async function makeSkillFixture(): Promise<SkillFixture> {
  const { conn, globalMetaVfs, projectMetaVfs, projects, sessions, sessionVfs } =
    getNovelMasterTestContext();
  const suffix = testIsolationSuffix();
  const project = await projects.create(`pj-sr-${suffix}-${fixtureCounter++}`);
  const session = await sessions.create(project.id);
  const service = new SkillsService({ conn, globalMetaVfs, projectMetaVfs });
  const ctx: BuiltinToolContext = {
    vfs: sessionVfs(project.id, session.id),
    projectId: project.id,
    sessionId: session.id,
    listSessionMessages: async () => [],
    skills: { service, projectId: project.id, effective: [] },
  };
  const registry = new ToolRegistry<BuiltinToolContext>();
  registerBuiltinTools(registry);
  return {
    projectId: project.id,
    sessionId: session.id,
    service,
    revisionRepo: new SqliteVfsRevisionRepository(conn),
    ctx,
    runner: new ToolRunner(registry),
  };
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

/** skill 落块（全文直出态：不得产 contentRef）。 */
function buildSkillBlock(
  toolUseId: string,
  output: SkillToolOutput
): ToolResultBlock {
  const block = buildToolResultBlock(
    toolUseId,
    { ok: true, output },
    { toolName: SKILL_TOOL_NAME, skillProjectId: undefined }
  );
  assert.equal(
    block.contentRef,
    undefined,
    "skill load/read 成功路径不得产 contentRef"
  );
  assert.notEqual(block.content, "", "全文直出：content 不得是占位空串");
  assert.equal(block.content, formatToolOutputForLlm(output));
  return block;
}

/** ref_count 点查；行不存在（已被 GC）返回 null。 */
async function refCountOf(
  entryId: number,
  version: number
): Promise<number | null> {
  const { conn } = getNovelMasterTestContext();
  const rows = await conn.query<{ ref_count: number }>(
    `SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?`,
    [entryId, version]
  );
  return rows.length === 0 ? null : Number(rows[0]!.ref_count);
}

/** 项目的 meta 域 scope_key（技能文件都落在这里，path 单独不唯一）。 */
function metaScopeKey(fx: SkillFixture): string {
  return `project:${fx.projectId}:meta`;
}

/** meta 域技能文件的 entry 行点查（按 scope + path 双条件唯一定位）。 */
async function entryOf(
  fx: SkillFixture,
  path: string
): Promise<{ entryId: number; contentHash: string }> {
  const { conn } = getNovelMasterTestContext();
  const entryRows = await conn.query<{ entry_id: number }>(
    `SELECT entry_id FROM vfs_entry WHERE scope_key = ? AND path = ?`,
    [metaScopeKey(fx), path]
  );
  assert.equal(entryRows.length, 1, `meta 域应恰有 ${path} 一个 entry 行`);
  const entryId = entryRows[0]!.entry_id;
  const revRows = await conn.query<{ content_hash: string }>(
    `SELECT content_hash FROM vfs_revision WHERE entry_id = ? AND version = 1`,
    [entryId]
  );
  assert.equal(revRows.length, 1, "写入后应有 v1 revision 行");
  return { entryId, contentHash: revRows[0]!.content_hash };
}

/**
 * 造一条 v1.5.29 存量 skill 引用块，并补上当初 read/load 发生的那次 `+1`
 * ——写侧已无引用化，不手工补就模拟不出「被引用持有」这一状态。
 */
async function seedLegacySkillRef(
  fx: SkillFixture,
  name: string,
  content: string,
  toolUseId: string,
  action: "load" | "read" = "read"
): Promise<{ block: ToolResultBlock; ref: SkillResultRef }> {
  await fx.service.writeSkillFile(
    "project",
    name,
    undefined,
    content,
    fx.projectId
  );
  const { entryId, contentHash } = await entryOf(
    fx,
    `/meta/skills/${name}/SKILL.md`
  );
  const lineCount = content.split("\n").length;
  // 存量 skill ref 的 `files` 是必填（parse 白名单硬要求），read 侧为空清单。
  const ref: SkillResultRef = {
    kind: "skill",
    action,
    domain: "project",
    name,
    path: "SKILL.md",
    entryId,
    version: 1,
    contentHash,
    totalBytes: content.length,
    offset: 1,
    ...(action === "read"
      ? { limit: 2000, returnedLines: lineCount, totalLines: lineCount }
      : {}),
    truncated: false,
    files: action === "load" ? ["refs/helper.md"] : [],
  };
  const { conn } = getNovelMasterTestContext();
  await conn.execute(
    `UPDATE vfs_revision SET ref_count = ref_count + 1 WHERE entry_id = ? AND version = 1`,
    [entryId]
  );
  return {
    block: {
      type: "tool_result",
      toolUseId,
      content: "",
      ok: true,
      summary: `${lineCount} lines`,
      contentRef: ref,
    },
    ref,
  };
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

/** 兜底 hydrate 后取回块 content（顺带断言 view-time 纪律：入参未被变异）。 */
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
  if (out.type !== "tool_result") throw new Error("expected tool_result");
  assert.deepEqual(out.contentRef, block.contentRef, "contentRef 原样保留");
  return out.content;
}

/** 捕获 console.warn（兜底路径唯一的可观测面）。 */
async function captureWarnings(run: () => Promise<void>): Promise<string[]> {
  const original = console.warn;
  const warns: string[] = [];
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return warns;
}

describe("skill-result-ref: 态一 · skill read 全文直出", () => {
  it("落块 content = 带行号全文、无 contentRef；输出不含三件套；ref_count 不被抬升", async () => {
    const fx = await makeSkillFixture();
    await seedProjectSkill(fx, "sr1-skill", "行一\n行二\n行三");

    const output = await callSkill(fx, { action: "read", name: "sr1-skill" });
    if (output.action !== "read") throw new Error("expected read output");
    assert.equal(output.domain, "project");

    // outputSchema 牙齿的**反向**面：三件套已随引用化删出 schema，
    // 工具输出里也不再有它们（zod strip 与实现同源，双保险）。
    const record = output as unknown as Record<string, unknown>;
    assert.equal(Object.hasOwn(record, "entryId"), false, "输出不再携带 entryId");
    assert.equal(
      Object.hasOwn(record, "contentHash"),
      false,
      "输出不再携带 contentHash"
    );
    assert.equal(
      Object.hasOwn(record, "totalBytes"),
      false,
      "输出不再携带 totalBytes"
    );

    // ref_count 恒为 live head 的 1（read 不再 +1）。
    const { entryId } = await entryOf(fx, "/meta/skills/sr1-skill/SKILL.md");
    assert.equal(await refCountOf(entryId, 1), 1, "skill read 不抬 ref_count");

    const block = buildSkillBlock("tu-sr1", output);
    assert.equal(block.ok, true);
    assert.equal(block.summary, "3 lines");
    assert.equal(block.content, "     1|行一\n     2|行二\n     3|行三");

    // 块过 parse round-trip 后仍是全文、仍无 contentRef。
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [block as ContentBlock] })
    );
    const roundTrip = parsed.blocks[0]!;
    if (roundTrip.type !== "tool_result") throw new Error("expected tool_result");
    assert.equal(roundTrip.contentRef, undefined);
    assert.equal(roundTrip.content, block.content);
  });

  it("ctx 上挂着会抛的 +1 通道残桩也不会被调用（引用化彻底摘除的牙齿）", async () => {
    const fx = await makeSkillFixture();
    await seedProjectSkill(fx, "sr1b-skill", "a\nb");
    let channelCalls = 0;
    const ctx = {
      ...fx.ctx,
      adjustRevisionRefCount: async () => {
        channelCalls += 1;
        throw new Error("skill read 不应再触发 revision +1（unref 已回迁）");
      },
    } as unknown as BuiltinToolContext;
    const output = await fx.runner.call<SkillToolOutput>(
      SKILL_TOOL_NAME,
      { action: "read", name: "sr1b-skill" },
      ctx
    );
    assert.equal(channelCalls, 0);
    const { entryId } = await entryOf(fx, "/meta/skills/sr1b-skill/SKILL.md");
    assert.equal(await refCountOf(entryId, 1), 1);
  });

  it("分页 / 截断变体同样全文直出（截断推导单源行为不变）", async () => {
    const fx = await makeSkillFixture();
    const lines = Array.from({ length: 12 }, (_, i) => `第${i + 1}行`);
    await seedProjectSkill(fx, "sr3-skill", lines.join("\n"));

    const variants: Array<{ offset?: number; limit?: number }> = [
      {},
      { offset: 3 },
      { offset: 3, limit: 4 },
      { limit: 5 },
      { offset: 11, limit: 5 },
    ];
    for (const [i, variant] of variants.entries()) {
      const output = await callSkill(fx, {
        action: "read",
        name: "sr3-skill",
        ...variant,
      });
      const block = buildSkillBlock(`tu-sr3-${i}`, output);
      // 全文直出即 wire：与工具执行时的格式化产物同源（不再是「重放等值」，
      // 而是写侧本来就把这份文本落库）。
      assert.equal(block.content, formatToolOutputForLlm(output));
      assert.equal(block.contentRef, undefined);
      assert.ok(block.content.includes(`|第${variant.offset ?? 1}行`));
    }

    // 超长单行：skill 的 truncateLine 管线（2000 字符）仍在。
    await seedProjectSkill(fx, "sr3b-skill", "长".repeat(3000));
    const longOutput = await callSkill(fx, {
      action: "read",
      name: "sr3b-skill",
    });
    const longBlock = buildSkillBlock("tu-sr3b", longOutput);
    assert.match(longBlock.content, /line truncated to 2000 chars/);
    assert.equal(longBlock.contentRef, undefined);
  });

  it("跨域同名（global / project 各一份）：两次 read 各自是本域全文，无引用", async () => {
    const fx = await makeSkillFixture();
    await fx.service.writeSkillFile(
      "global",
      "sr1c-dup",
      undefined,
      "global-第一行\nglobal-第二行"
    );
    await fx.service.writeSkillFile(
      "project",
      "sr1c-dup",
      undefined,
      "project-第一行\nproject-第二行",
      fx.projectId
    );

    const byDefault = await callSkill(fx, {
      action: "read",
      name: "sr1c-dup",
    });
    assert.equal(byDefault.domain, "project", "缺省域按生效副本解析");
    const byGlobal = await callSkill(fx, {
      action: "read",
      name: "sr1c-dup",
      domain: "global",
    });
    assert.equal(byGlobal.domain, "global", "显式域必须打 global 本体");

    const projectBlock = buildSkillBlock("tu-sr1c-project", byDefault);
    const globalBlock = buildSkillBlock("tu-sr1c-global", byGlobal);
    assert.match(projectBlock.content, /project-第一行/);
    assert.match(globalBlock.content, /global-第一行/);
    assert.equal(
      projectBlock.content.includes("global-第一行"),
      false,
      "两份正文不串味"
    );
    // 两条 entry 各自持有自己的 head，read 不抬 ref。
    const projectEntry = await entryOf(fx, "/meta/skills/sr1c-dup/SKILL.md");
    assert.equal(await refCountOf(projectEntry.entryId, 1), 1);
  });
});

describe("skill-result-ref: 态一 · skill load 全文直出", () => {
  it("load：行号全文 + 附属文件尾注，无 contentRef，ref_count 不被抬升", async () => {
    const fx = await makeSkillFixture();
    await seedProjectSkill(fx, "sr4-skill", "技能正文第一行\n技能正文第二行");

    const output = await callSkill(fx, { action: "load", name: "sr4-skill" });
    if (output.action !== "load") throw new Error("expected load output");
    assert.deepEqual([...output.files], ["refs/helper.md"]);
    const { entryId } = await entryOf(fx, "/meta/skills/sr4-skill/SKILL.md");
    assert.equal(await refCountOf(entryId, output.version), 1, "load 不抬 ref_count");

    const block = buildSkillBlock("tu-sr4", output);
    assert.equal(block.summary, "project:sr4-skill · 1 files");
    assert.match(block.content, /     1\|技能正文第一行/);
    assert.match(block.content, /附属文件（相对技能目录）：refs\/helper\.md/);

    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [block as ContentBlock] })
    );
    const rt = parsed.blocks[0]!;
    if (rt.type !== "tool_result") throw new Error("expected tool_result");
    assert.equal(rt.contentRef, undefined);
    assert.equal(rt.content, block.content);
  });

  it("alreadyReferenced 形态仍走全文常量 tip、不抬 ref、无 contentRef", async () => {
    const fx = await makeSkillFixture();
    await seedProjectSkill(fx, "sr4b-skill", "正文");

    const output = await callSkill(
      fx,
      { action: "load", name: "sr4b-skill" },
      new Set(["sr4b-skill"])
    );
    if (output.action !== "load") throw new Error("expected load output");
    assert.equal(output.alreadyReferenced, true);
    assert.deepEqual([...output.files], []);

    const { entryId } = await entryOf(fx, "/meta/skills/sr4b-skill/SKILL.md");
    assert.equal(
      await refCountOf(entryId, output.version),
      1,
      "已注入过全文的形态不抬 ref"
    );

    const block = buildToolResultBlock(
      "tu-sr4b",
      { ok: true, output },
      { toolName: SKILL_TOOL_NAME }
    );
    assert.equal(block.contentRef, undefined);
    assert.match(block.content, /已在本请求提示词中/);
  });
});

describe("skill-result-ref: 态二 · 兜底 hydrate 存量 skill 引用行", () => {
  it("存量 read ref 行 → {path, content} JSON 包（files 等派生字段弃置）", async () => {
    const fx = await makeSkillFixture();
    const { block, ref } = await seedLegacySkillRef(
      fx,
      "sr5-skill",
      "存量正文一\n存量正文二",
      "tu-sr5"
    );

    // parse 白名单必须保住 kind/action/domain/name/files——窄化与兜底都靠它。
    const parsed = parseMessageContent(
      JSON.stringify({ blocks: [block as ContentBlock] })
    );
    const rt = parsed.blocks[0]!;
    if (rt.type !== "tool_result") throw new Error("expected tool_result");
    assert.deepEqual(rt.contentRef, ref);

    let content = "";
    const warns = await captureWarnings(async () => {
      content = await hydrateContent(block, fx.revisionRepo);
    });
    assert.deepEqual(JSON.parse(content), {
      path: "SKILL.md",
      content: "存量正文一\n存量正文二",
    });
    assert.deepEqual(warns, [], "取得到明文不该 warn");
  });

  it("存量 load ref 行同款形态", async () => {
    const fx = await makeSkillFixture();
    const { block } = await seedLegacySkillRef(
      fx,
      "sr5b-skill",
      "load 正文\n第二行",
      "tu-sr5b",
      "load"
    );
    const content = await hydrateContent(block, fx.revisionRepo);
    assert.deepEqual(JSON.parse(content), {
      path: "SKILL.md",
      content: "load 正文\n第二行",
    });
    assert.equal(
      content.includes("helper.md"),
      false,
      "files 清单不进兜底包（过渡期派生字段弃置）"
    );
  });

  it("revision 行缺失（悬空引用）→ 错误占位 JSON + warn，不再 fail-fast 抛错", async () => {
    const fx = await makeSkillFixture();
    const { block, ref } = await seedLegacySkillRef(
      fx,
      "sr5c-skill",
      "悬空正文\n第二行",
      "tu-sr5c"
    );
    const { conn } = getNovelMasterTestContext();
    // 裸 DELETE（绕过 ref_count）：引用块还在，目标 revision 已不复存在。
    await conn.execute(
      `DELETE FROM vfs_revision WHERE entry_id = ? AND version = ?`,
      [ref.entryId, ref.version]
    );
    assert.equal(await refCountOf(ref.entryId, ref.version), null);

    let content = "";
    const warns = await captureWarnings(async () => {
      content = await hydrateContent(block, fx.revisionRepo);
    });
    const parsed = JSON.parse(content) as { path: string; error: string };
    assert.equal(parsed.path, "SKILL.md");
    assert.match(parsed.error, /取不回/);
    assert.ok(
      warns.some((w) => /skill read 引用/.test(w)),
      `warn 点名这是 skill 引用行，实际：${warns.join(" | ")}`
    );
  });

  it("contentHash 篡改 → 照常回填明文 + warn（不算坏行、不占位）", async () => {
    const fx = await makeSkillFixture();
    const { block, ref } = await seedLegacySkillRef(
      fx,
      "sr5d-skill",
      "v1-原正文",
      "tu-sr5d"
    );
    const tampered: ToolResultBlock = {
      ...block,
      contentRef: { ...ref, contentHash: "0".repeat(64) },
    };
    let content = "";
    const warns = await captureWarnings(async () => {
      content = await hydrateContent(tampered, fx.revisionRepo);
    });
    assert.deepEqual(JSON.parse(content), {
      path: "SKILL.md",
      content: "v1-原正文",
    });
    assert.ok(
      warns.some((w) => /contentHash/.test(w)),
      `指纹漂移留 warn 线索但不阻断，实际：${warns.join(" | ")}`
    );
  });

  it("skill edit 产生中间版本：被存量引用持有的版本 sweep 保活、hydrate 仍正常", async () => {
    const fx = await makeSkillFixture();
    const { block } = await seedLegacySkillRef(fx, "sr6-skill", "v1-第一行", "tu-sr6");
    const { entryId } = await entryOf(fx, "/meta/skills/sr6-skill/SKILL.md");
    // live head(1) + 存量引用(1) = 2。
    assert.equal(await refCountOf(entryId, 1), 2);

    // skill edit 产生 v2：v1 失去 live head 持有（−1），只剩存量引用 → 1。
    await fx.service.editSkillFile(
      "project",
      "sr6-skill",
      undefined,
      { oldString: "v1-第一行", newString: "v2-第二行" },
      fx.projectId
    );
    assert.equal(
      await refCountOf(entryId, 1),
      1,
      "被存量 skill 引用持有的历史版本必须保留 1 份"
    );

    // sweep（技能删除会走的同款原语）不得误删被引用版本。
    const { conn } = getNovelMasterTestContext();
    await conn.transaction(async (tx) => {
      await sweepRevisionsUnderScope(
        new SqliteVfsEntryRepository(tx),
        new SqliteVfsRevisionRepository(tx),
        `project:${fx.projectId}:meta`,
        `${SKILLS_ROOT}/sr6-skill-other`
      );
    });
    assert.notEqual(
      await refCountOf(entryId, 1),
      null,
      "被引用版本不得被 sweep 回收"
    );
    // 兜底 hydrate 回填的是 v1 那一版正文（不是当前 head）。
    assert.deepEqual(JSON.parse(await hydrateContent(block, fx.revisionRepo)), {
      path: "SKILL.md",
      content: "v1-第一行",
    });
  });

  it("技能删除（sweepRevisionsUnderScope 路径）：存量引用保活、hydrate 正常", async () => {
    const fx = await makeSkillFixture();
    const { block } = await seedLegacySkillRef(
      fx,
      "sr7-skill",
      "删除前的技能正文\n第二行",
      "tu-sr7"
    );
    const { entryId } = await entryOf(fx, "/meta/skills/sr7-skill/SKILL.md");
    assert.equal(await refCountOf(entryId, 1), 2);

    await fx.service.deleteSkill({
      domain: "project",
      projectId: fx.projectId,
      name: "sr7-skill",
    });

    // live head −1 后只剩存量引用 → 存活。
    assert.equal(await refCountOf(entryId, 1), 1);
    assert.deepEqual(JSON.parse(await hydrateContent(block, fx.revisionRepo)), {
      path: "SKILL.md",
      content: "删除前的技能正文\n第二行",
    });
  });

  it("技能改名（renamePrefix）后旧 ref 仍按 (entryId, version) 定位", async () => {
    const fx = await makeSkillFixture();
    const { block, ref } = await seedLegacySkillRef(
      fx,
      "sr8-old",
      "改名前的正文\n第二行",
      "tu-sr8"
    );

    await fx.service.updateSkillInfo(
      { domain: "project", projectId: fx.projectId, name: "sr8-old" },
      { newName: "sr8-new" }
    );

    // renamePrefix 是单事务 path REPLACE、entry_id 保留——旧 ref 的
    // (entryId, version) 键不受影响（path 本就只是展示用）。
    const afterRows = await getNovelMasterTestContext().conn.query<{
      entry_id: number;
      path: string;
    }>(
      `SELECT entry_id, path FROM vfs_entry WHERE scope_key = ? AND path LIKE ?`,
      [metaScopeKey(fx), "/meta/skills/sr8-%"]
    );
    const skillEntryRow = afterRows.find((r) => r.path.endsWith("SKILL.md"));
    assert.ok(skillEntryRow != null, "改名后 SKILL.md 行仍在");
    assert.equal(
      skillEntryRow.path,
      "/meta/skills/sr8-new/SKILL.md",
      "改名后文件路径已迁到新目录"
    );
    assert.equal(
      skillEntryRow.entry_id,
      ref.entryId,
      "改名走 renamePrefix：SKILL.md 的 entry_id 保留（引用键不受影响）"
    );
    assert.ok(afterRows.every((r) => !r.path.includes("sr8-old")));

    assert.equal(
      await refCountOf(ref.entryId, ref.version),
      2,
      "live head 仍持有（entry_id 保留）"
    );
    assert.deepEqual(JSON.parse(await hydrateContent(block, fx.revisionRepo)), {
      path: "SKILL.md",
      content: "改名前的正文\n第二行",
    });
  });

  it("ZIP 导入重开 entry 后旧 ref 仍定位（两条导入路径各跑一遍）", async () => {
    /**
     * 导入替换的实现形态有两种（`sweepRevisionsUnderScope` 扣 live 后按
     * ref_count 回收 / 仅 `deleteVfsPrefix` 删 entry 行）。断言**不依赖具体
     * 形态**：`(entryId, version)` 定位与兜底 hydrate 两条路径天然满足。
     */
    for (const mode of ["sweep", "prefixDelete"] as const) {
      const fx = await makeSkillFixture();
      const { block } = await seedLegacySkillRef(
        fx,
        "sr9-skill",
        "导入前旧内容\n第二行",
        `tu-sr9-${mode}`
      );
      const oldEntry = await entryOf(fx, "/meta/skills/sr9-skill/SKILL.md");

      // 「导入」= 该技能目录被整体替换（entry 行删除 + 同路径重开新 entry）。
      const { conn } = getNovelMasterTestContext();
      await conn.transaction(async (tx) => {
        const entryRepo = new SqliteVfsEntryRepository(tx);
        const revisionRepo = new SqliteVfsRevisionRepository(tx);
        const scopeKey = `project:${fx.projectId}:meta`;
        if (mode === "sweep") {
          await sweepRevisionsUnderScope(
            entryRepo,
            revisionRepo,
            scopeKey,
            `${SKILLS_ROOT}/sr9-skill`
          );
        } else {
          await deleteVfsPrefix(
            entryRepo,
            scopeKey,
            `${SKILLS_ROOT}/sr9-skill`
          );
        }
      });
      // 同路径重新种入（entry_id 重开为新值）。
      await seedProjectSkill(fx, "sr9-skill", "导入后新内容");
      const newEntry = await entryOf(fx, "/meta/skills/sr9-skill/SKILL.md");
      assert.notEqual(
        newEntry.entryId,
        oldEntry.entryId,
        `${mode} 导入后应是新 entry`
      );

      // 旧 ref 仍按 (oldEntryId, 1) hydrate 出**旧内容**。
      assert.deepEqual(JSON.parse(await hydrateContent(block, fx.revisionRepo)), {
        path: "SKILL.md",
        content: "导入前旧内容\n第二行",
      });
      assert.ok(
        (await refCountOf(oldEntry.entryId, 1)) != null,
        `${mode}：被存量引用的旧 revision 必须存活`
      );
    }
  });

  it("消息删除挂点对存量 skill ref 的 −1 生效（collectReadRefs 含 skill ref）", async () => {
    const fx = await makeSkillFixture();
    const { block } = await seedLegacySkillRef(fx, "sr10-skill", "x\ny", "tu-sr10");
    const { entryId } = await entryOf(fx, "/meta/skills/sr10-skill/SKILL.md");
    assert.equal(await refCountOf(entryId, 1), 2);

    const { messages } = getNovelMasterTestContext();
    const msg = await messages.append(fx.sessionId, "assistant", {
      blocks: [block as ContentBlock],
    });
    await messages.delete(msg.id);
    assert.equal(
      await refCountOf(entryId, 1),
      1,
      "删除持存量引用的消息后 −1 生效（live head 的 1 份留下）"
    );
  });

  it("截断删尾挂点：被删尾消息的存量 skill ref −1 先于 sweep", async () => {
    const fx = await makeSkillFixture();
    const { block } = await seedLegacySkillRef(
      fx,
      "sr11-skill",
      "tail-引用正文",
      "tu-sr11"
    );
    const { entryId } = await entryOf(fx, "/meta/skills/sr11-skill/SKILL.md");
    assert.equal(await refCountOf(entryId, 1), 2);

    const { conn, messages, sessionKkv } = getNovelMasterTestContext();
    await messages.append(fx.sessionId, "user", {
      blocks: [{ type: "text", text: "保活锚点" } as ContentBlock],
    });
    await messages.append(fx.sessionId, "assistant", {
      blocks: [block as ContentBlock],
    });

    const effects = new DefaultMessageTranscriptEffectsService({
      conn,
      messages,
      sessionKkv,
    });
    await effects.truncateMessagesAfter(fx.projectId, fx.sessionId, 1, {
      sweepRevisions: true,
    });

    // −1 先于 sweep：删掉的引用不再保活（本例 live head 仍持有 → 剩 1）。
    assert.equal(await refCountOf(entryId, 1), 1);
  });
});
