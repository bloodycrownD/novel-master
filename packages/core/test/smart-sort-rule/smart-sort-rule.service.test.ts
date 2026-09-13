import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { SmartSortRuleError } from "@/errors/smart-sort-rule-errors.js";
import { seedBuiltinSmartSortRules } from "@/bootstrap/smart-sort-rule/builtin-smart-sort-rules.js";
import { isBuiltinSmartSortRuleId } from "@/domain/smart-sort-rule/model/smart-sort-rule.js";
import { createSmartSortRuleService } from "@/service/smart-sort-rule/create-smart-sort-rule.service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** bootstrap seed 后的内置规则 id 集（sort_order 1..7，spec 附录 A + D13）。 */
const BUILTIN_IDS = [
  "builtin-zh-prologue",
  "builtin-zh-finale",
  "builtin-zh-extra",
  "builtin-zh-volume-chapter",
  "builtin-zh-chapter",
  "builtin-en-chapter",
  "builtin-numeric",
];

/** 共享库用例隔离：删全部用户规则 + 重灌内置（恢复默认顺序与启用态）。 */
beforeEach(async () => {
  const ctx = getNovelMasterTestContext();
  const svc = createSmartSortRuleService(ctx.conn);
  for (const rule of await svc.listRules()) {
    if (!isBuiltinSmartSortRuleId(rule.ruleId)) {
      await svc.deleteRule(rule.ruleId);
    }
  }
  await svc.resetDefaults();
});

function sortOrdersAreConsecutiveFromOne(
  rules: readonly { sortOrder: number }[]
): boolean {
  return rules.every((r, i) => r.sortOrder === i + 1);
}

describe("T-SR1: SmartSortRuleService CRUD/move/reorder", () => {
  it("create appends at next sort order; listRules returns builtin seed first", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const created = await svc.createRule({
      name: "我的规则",
      pattern: "第([0-9]+)话",
      description: "匹配 第X话 序号",
    });
    assert.ok(created.ruleId.startsWith("rule-"));
    assert.equal(created.flags, "");
    assert.equal(created.enabled, true);
    const rules = await svc.listRules();
    assert.equal(rules.length, BUILTIN_IDS.length + 1);
    assert.equal(rules[0]!.ruleId, "builtin-zh-prologue");
    assert.equal(rules.at(-1)!.ruleId, created.ruleId);
    assert.ok(
      sortOrdersAreConsecutiveFromOne(rules),
      `sort_order 应连续 1..N，实际 ${rules.map((r) => r.sortOrder).join(",")}`
    );
  });

  it("updateRule merges patch and validates the merged draft", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const created = await svc.createRule({
      name: "a",
      pattern: "第([0-9]+)话",
    });
    const updated = await svc.updateRule(created.ruleId, {
      name: "b",
      enabled: false,
    });
    assert.equal(updated.name, "b");
    assert.equal(updated.enabled, false);
    assert.equal(updated.pattern, "第([0-9]+)话");
    await assert.rejects(
      () => svc.updateRule(created.ruleId, { pattern: "第[0-9]+话" }),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
  });

  it("moveRule top/up/down/bottom + reorderRules keep sort_order consecutive 1..N", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const a = await svc.createRule({ name: "a", pattern: "(\\d+)" });
    const b = await svc.createRule({ name: "b", pattern: "(\\d+)" });
    const c = await svc.createRule({ name: "c", pattern: "(\\d+)" });

    let rules = await svc.moveRule(c.ruleId, "top");
    assert.deepEqual(
      rules.map((r) => r.ruleId),
      [c.ruleId, ...BUILTIN_IDS, a.ruleId, b.ruleId]
    );
    assert.ok(sortOrdersAreConsecutiveFromOne(rules));

    rules = await svc.moveRule(c.ruleId, "down");
    assert.equal(rules[0]!.ruleId, BUILTIN_IDS[0]);

    rules = await svc.moveRule(a.ruleId, { index: 1 });
    assert.equal(rules[1]!.ruleId, a.ruleId);
    assert.ok(sortOrdersAreConsecutiveFromOne(rules));

    const allIds = (await svc.listRules()).map((r) => r.ruleId);
    rules = await svc.reorderRules([...allIds].reverse());
    assert.deepEqual(
      rules.map((r) => r.ruleId),
      [...allIds].reverse()
    );
    assert.ok(sortOrdersAreConsecutiveFromOne(rules));
  });

  it("reorderRules rejects partial / duplicated id lists", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const ids = (await svc.listRules()).map((r) => r.ruleId);
    await assert.rejects(
      () => svc.reorderRules(ids.slice(1)),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
    await assert.rejects(
      () => svc.reorderRules([...ids, ids[0]!]),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
  });

  it("delete/deleteBatch reject builtin- prefixed rules (D3)", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    await assert.rejects(
      () => svc.deleteRule("builtin-zh-chapter"),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "BUILTIN_PROTECTED"
    );
    const mine = await svc.createRule({ name: "m", pattern: "(\\d+)" });
    await assert.rejects(
      () => svc.deleteBatch([mine.ruleId, "builtin-numeric"]),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "BUILTIN_PROTECTED"
    );
    // 整体拒绝：用户规则也不应被删（半删防护）
    assert.ok((await svc.listRules()).some((r) => r.ruleId === mine.ruleId));
    await svc.deleteBatch([mine.ruleId]);
    assert.ok(
      !(await svc.listRules()).some((r) => r.ruleId === mine.ruleId)
    );
  });

  it("setEnabled(Batch) toggles without touching order", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const a = await svc.createRule({ name: "a", pattern: "(\\d+)" });
    const b = await svc.createRule({ name: "b", pattern: "(\\d+)" });
    await svc.setEnabledBatch([a.ruleId, b.ruleId], false);
    const compiled = await svc.listCompiledRules();
    assert.ok(!compiled.some((r) => r.ruleId === a.ruleId));
    assert.ok(!compiled.some((r) => r.ruleId === b.ruleId));
    const enabled = await svc.setEnabled(a.ruleId, true);
    assert.equal(enabled.enabled, true);
    assert.ok((await svc.listCompiledRules()).some((r) => r.ruleId === a.ruleId));
  });

  it("previewSort reports matched rule + nums and sorts accordingly", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const result = await svc.previewSort([
      "第十章 风起.txt",
      "第2卷 第13章.txt",
      "001、开端.txt",
      "Chapter 12.txt",
    ]);
    const byName = new Map(result.lines.map((l) => [l.name, l]));
    assert.deepEqual(byName.get("第2卷 第13章.txt")!.nums, [2, 13]);
    assert.equal(byName.get("第2卷 第13章.txt")!.matchedRuleId, "builtin-zh-volume-chapter");
    assert.deepEqual(byName.get("第十章 风起.txt")!.nums, [10]);
    assert.equal(byName.get("001、开端.txt")!.matchedRuleId, "builtin-numeric");
    assert.deepEqual(byName.get("Chapter 12.txt")!.nums, [12]);
    // 排序后（元组逐位）：001 [1] < 第2卷 [2,13] < 第十章 [10] < Chapter 12 [12]
    assert.deepEqual(result.sortedNames, [
      "001、开端.txt",
      "第2卷 第13章.txt",
      "第十章 风起.txt",
      "Chapter 12.txt",
    ]);
  });

  it("D13：previewSort 内置七条下序章哨兵最前、终章/番外沉底（同值文件名决胜）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const result = await svc.previewSort([
      "终章.txt",
      "第十章.txt",
      "序章.txt",
      "番外.txt",
      "第一章.txt",
    ]);
    const byName = new Map(result.lines.map((l) => [l.name, l]));
    assert.equal(byName.get("序章.txt")!.matchedRuleId, "builtin-zh-prologue");
    assert.equal(byName.get("序章.txt")!.nums?.[0], -Infinity);
    assert.equal(byName.get("终章.txt")!.matchedRuleId, "builtin-zh-finale");
    assert.equal(byName.get("终章.txt")!.nums?.[0], Infinity);
    assert.equal(byName.get("番外.txt")!.matchedRuleId, "builtin-zh-extra");
    // 同为 +∞：「番」U+756A <「终」U+7EC8 → 番外在终章前（D13 同值 tiebreak
    // 定稿接受现状，测试锁行为；如需终章在前须改用不同权重——已否决）。
    assert.deepEqual(result.sortedNames, [
      "序章.txt",
      "第一章.txt",
      "第十章.txt",
      "番外.txt",
      "终章.txt",
    ]);
  });

  it("D13：create/update 携带 captureKind 且 round-trip 无损（缺省 smart）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const fixed = await svc.createRule({
      name: "序章类",
      pattern: "^(序章?|楔子)",
      captureKind: "fixed_min",
    });
    assert.equal(fixed.captureKind, "fixed_min");
    const smart = await svc.createRule({ name: "数字", pattern: "(\\d+)" });
    assert.equal(smart.captureKind, "smart", "缺省 smart");
    const patched = await svc.updateRule(smart.ruleId, {
      captureKind: "fixed_max",
    });
    assert.equal(patched.captureKind, "fixed_max");
    // 非法档位被 zod 拒。
    await assert.rejects(
      () =>
        svc.createRule({
          name: "bad",
          pattern: "(\\d+)",
          captureKind: "bogus" as unknown as "smart",
        }),
      Error
    );
  });
});

describe("T-SR2: resetDefaults 与 seed 幂等", () => {
  it("resetDefaults 只删 builtin-% 重灌，用户规则不动且顺序保持", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const mine = await svc.createRule({ name: "mine", pattern: "(\\d+)" });
    // 禁用内置 + 给用户规则改名，验证 resetDefaults 不影响用户规则
    await svc.setEnabled("builtin-zh-chapter", false);
    await svc.updateRule(mine.ruleId, { name: "mine-renamed" });

    await svc.resetDefaults();

    const rules = await svc.listRules();
    const ids = rules.map((r) => r.ruleId);
    assert.deepEqual(ids, [...BUILTIN_IDS, mine.ruleId]);
    const mineRow = rules.find((r) => r.ruleId === mine.ruleId)!;
    assert.equal(mineRow.name, "mine-renamed");
    const zhChapter = rules.find((r) => r.ruleId === "builtin-zh-chapter")!;
    assert.equal(zhChapter.enabled, true, "重灌后内置恢复默认启用");
    assert.ok(
      sortOrdersAreConsecutiveFromOne(rules),
      "重灌后整表重编号连续 1..N"
    );
  });

  it("resetDefaults 后用户置顶规则回落到 builtin 默认序之后（B-2，不按 rule_id 决胜交错）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const mine = await svc.createRule({ name: "mine", pattern: "(\\d+)" });
    // 用户规则置顶：sort_order=1，与重灌 builtin 的种子 sortOrder 1..7 撞号
    await svc.moveRule(mine.ruleId, "top");

    await svc.resetDefaults();

    const rules = await svc.listRules();
    assert.deepEqual(
      rules.map((r) => r.ruleId),
      [...BUILTIN_IDS, mine.ruleId],
      "builtin 恒在前 7 位（默认序），用户规则紧随其后"
    );
    assert.ok(
      sortOrdersAreConsecutiveFromOne(rules),
      "重灌后 sort_order 连续 1..N"
    );
  });

  it("seed 幂等不覆盖存量行（禁用内置后重跑 seed 保持禁用，D3）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    await svc.setEnabled("builtin-en-chapter", false);
    await seedBuiltinSmartSortRules(ctx.conn);
    const rules = await svc.listRules();
    const en = rules.find((r) => r.ruleId === "builtin-en-chapter")!;
    assert.equal(en.enabled, false, "INSERT OR IGNORE 不覆盖存量禁用态");
    const zh = rules.find((r) => r.ruleId === "builtin-zh-chapter")!;
    assert.equal(zh.enabled, true);
  });
});

describe("T-SR3: export→import round-trip 无损（替换式）", () => {
  it("round-trip 保留 ruleId/enabled/description 与顺序（sort_order 重编号后顺序一致）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const a = await svc.createRule({
      name: "a",
      pattern: "(\\d+)",
      description: "规则 a 的描述",
    });
    await svc.createRule({ name: "b", pattern: "(\\d+)", enabled: false });
    // D13：fixed 档规则入 bundle round-trip。
    await svc.createRule({
      name: "c-fixed",
      pattern: "^(番外|外传)",
      captureKind: "fixed_max",
    });
    await svc.setEnabled("builtin-zh-chapter", false);
    const before = await svc.listRules();
    const doc = await svc.exportRules();
    assert.equal(doc.schemaVersion, 2, "bundle 文档 schemaVersion 升到 2");
    assert.ok(
      doc.rules.some((r) => r.captureKind === "fixed_max"),
      "导出应携带 fixed_max 档（D13）"
    );

    // 导出后改库：删除一条用户规则 + 移动顺序
    await svc.deleteRule(a.ruleId);
    await svc.moveRule("builtin-numeric", "top");

    const imported = await svc.importRules(doc);
    assert.deepEqual(
      imported.map((r) => r.ruleId),
      before.map((r) => r.ruleId),
      "导入后 id 顺序与导出时一致"
    );
    assert.deepEqual(
      imported.map((r) => r.enabled),
      before.map((r) => r.enabled),
      "导入后 enabled 状态与导出时一致"
    );
    assert.deepEqual(
      imported.map((r) => r.description),
      before.map((r) => r.description),
      "导入后 description 与导出时一致"
    );
    assert.deepEqual(
      imported.map((r) => r.captureKind),
      before.map((r) => r.captureKind),
      "导入后 captureKind 与导出时一致（D13）"
    );
    assert.ok(sortOrdersAreConsecutiveFromOne(imported));
  });

  it("importRules 兼容 v1 旧文档（example 字段自动映射为 description）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const imported = await svc.importRules({
      schemaVersion: 1,
      rules: [
        {
          ruleId: "rule-v1-legacy",
          name: "旧文档规则",
          pattern: "第([0-9]+)话",
          flags: "",
          example: "第12话",
          enabled: true,
          sortOrder: 1,
        },
      ],
    });
    assert.equal(imported.length, 1);
    assert.equal(imported[0]!.description, "第12话", "旧 example 值应落到 description");
  });

  it("importRules 拒绝重复 ruleId 与非法规则（先校验后替换，不半删）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    const before = await svc.listRules();
    const doc = await svc.exportRules();
    const duplicate = structuredClone(doc);
    duplicate.rules.push({ ...duplicate.rules[0]! });
    await assert.rejects(
      () => svc.importRules(duplicate),
      (e: unknown) => e instanceof SmartSortRuleError && e.code === "CONFLICT"
    );
    const invalid = structuredClone(doc);
    invalid.rules.push({
      ruleId: "rule-bad",
      name: "bad",
      pattern: "第[0-9]+章",
      flags: "",
      enabled: true,
      sortOrder: 99,
    });
    await assert.rejects(
      () => svc.importRules(invalid),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
    // 校验失败不落半删状态
    assert.deepEqual(
      (await svc.listRules()).map((r) => r.ruleId),
      before.map((r) => r.ruleId)
    );
  });
});

describe("T-SR4: 非法正则/零捕获组/非法 flags 被拒", () => {
  it("create rejects uncompilable pattern with INVALID_PATTERN", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    await assert.rejects(
      () => svc.createRule({ name: "bad", pattern: "第([0-9]+章" }),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_PATTERN"
    );
  });

  it("create rejects zero-capture-group pattern with INVALID_ARGUMENT", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    await assert.rejects(
      () => svc.createRule({ name: "bad", pattern: "第[0-9]+章" }),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
  });

  it("D13：fixed 档不强制捕获组；切回 smart 时零捕获组才被拒", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    // fixed 档 + 无捕获组：合法（命中即哨兵，捕获组被忽略）。
    const fixed = await svc.createRule({
      name: "序章类",
      pattern: "^序章",
      captureKind: "fixed_min",
    });
    assert.equal(fixed.captureKind, "fixed_min");
    // fixed 档 + 捕获组共存：同样合法（固定元组优先）。
    await svc.createRule({
      name: "终章类",
      pattern: "^(终章|尾声)([0-9]*)",
      captureKind: "fixed_max",
    });
    // 切回 smart：零捕获组开始被拒（按合并后档位校验）。
    await assert.rejects(
      () => svc.updateRule(fixed.ruleId, { captureKind: "smart" }),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
  });

  it("create/update reject invalid flags (非 gimsuy 字符 / 重复)", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createSmartSortRuleService(ctx.conn);
    await assert.rejects(
      () => svc.createRule({ name: "bad", pattern: "(\\d+)", flags: "gx" }),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
    await assert.rejects(
      () => svc.createRule({ name: "bad", pattern: "(\\d+)", flags: "gg" }),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
    const ok = await svc.createRule({
      name: "ok",
      pattern: "(\\d+)",
      flags: "i",
    });
    await assert.rejects(
      () => svc.updateRule(ok.ruleId, { flags: "x" }),
      (e: unknown) =>
        e instanceof SmartSortRuleError && e.code === "INVALID_ARGUMENT"
    );
    const stillOk = await svc.updateRule(ok.ruleId, { flags: "gi" });
    assert.equal(stillOk.flags, "gi");
  });
});
