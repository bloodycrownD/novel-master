/**
 * 内置智能排序规则 seed 行为测试（T-SR2 的 seed 部分 + 附录 A 常量锁）。
 *
 * 覆盖：
 *  1. bootstrap 后四条内置规则种入（rule_id / sort_order / flags / example）；
 *  2. seed 幂等：INSERT OR IGNORE 不覆盖存量行（禁用+改名后重跑保持原样，
 *     D3「禁用某内置规则后重启保持禁用」）；
 *  3. 用户规则与 seed 隔离（不被覆盖也不被清掉）；
 *  4. 附录 A 常量锁：四条 pattern 均可编译、命中 example 且捕获组提取正确
 *    （防 spec 手抄转义漂移）。
 *
 * @module test/bootstrap/smart-sort-rule-seed.test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapNovelMaster, open } from "@novel-master/core";
import {
  BETTER_SQLITE3_DRIVER_NAME,
  registerBetterSqlite3Driver,
} from "@novel-master/tdbc-driver-better-sqlite3";
import {
  BUILTIN_SMART_SORT_RULE_ROWS,
  seedBuiltinSmartSortRules,
} from "../../src/bootstrap/smart-sort-rule/builtin-smart-sort-rules.js";

async function openBootstrappedConn() {
  registerBetterSqlite3Driver();
  const conn = await open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });
  await bootstrapNovelMaster(conn);
  return conn;
}

type RuleRow = {
  rule_id: string;
  name: string;
  pattern: string;
  flags: string;
  example: string | null;
  enabled: number;
  sort_order: number;
};

describe("内置智能排序规则 seed", () => {
  it("bootstrap 后四条内置规则按附录 A 种入（sort_order 1..4、en-chapter flags='i'）", async () => {
    const conn = await openBootstrappedConn();
    try {
      const rows = await conn.query<RuleRow>(
        `SELECT rule_id, name, pattern, flags, example, enabled, sort_order
         FROM smart_sort_rule WHERE rule_id LIKE 'builtin-%' ORDER BY sort_order`
      );
      assert.equal(rows.length, 4);
      assert.deepEqual(
        rows.map((r) => r.rule_id),
        [
          "builtin-zh-volume-chapter",
          "builtin-zh-chapter",
          "builtin-en-chapter",
          "builtin-numeric",
        ]
      );
      assert.deepEqual(
        rows.map((r) => r.sort_order),
        [1, 2, 3, 4]
      );
      const enChapter = rows.find((r) => r.rule_id === "builtin-en-chapter");
      assert.equal(enChapter?.flags, "i");
      for (const row of rows) {
        assert.equal(row.enabled, 1);
        // seed 行内容与常量逐字段一致（不含时间戳）。
        const src = BUILTIN_SMART_SORT_RULE_ROWS.find(
          (r) => r.ruleId === row.rule_id
        );
        assert.ok(src != null);
        assert.equal(row.name, src.name);
        assert.equal(row.pattern, src.pattern);
        assert.equal(row.flags, src.flags);
        assert.equal(row.example, src.example);
      }
    } finally {
      await conn.close();
    }
  });

  it("seed 幂等：禁用+改名后的内置规则不被覆盖（D3）", async () => {
    const conn = await openBootstrappedConn();
    try {
      await conn.execute(
        `UPDATE smart_sort_rule SET enabled = 0, name = '我的改名', updated_at_ms = updated_at_ms + 1
         WHERE rule_id = 'builtin-zh-chapter'`
      );

      await seedBuiltinSmartSortRules(conn);

      const row = await conn.query<RuleRow>(
        `SELECT rule_id, name, enabled FROM smart_sort_rule WHERE rule_id = 'builtin-zh-chapter'`
      );
      assert.equal(row[0]?.enabled, 0, "禁用状态应保持（不覆盖）");
      assert.equal(row[0]?.name, "我的改名", "用户改名应保持（不覆盖）");

      // 行数不膨胀：仍只有四条 builtin。
      const all = await conn.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM smart_sort_rule WHERE rule_id LIKE 'builtin-%'`
      );
      assert.equal(Number(all[0]?.n ?? 0), 4);
    } finally {
      await conn.close();
    }
  });

  it("用户规则与 seed 隔离：seed 重跑不动用户行", async () => {
    const conn = await openBootstrappedConn();
    try {
      await conn.execute(
        `INSERT INTO smart_sort_rule (
           rule_id, name, pattern, flags, example, enabled,
           sort_order, created_at_ms, updated_at_ms
         ) VALUES ('user-mine', '我的规则', '^番外([0-9]+)', '', '番外3', 1, 9, 1, 1)`
      );

      await seedBuiltinSmartSortRules(conn);

      const row = await conn.query<RuleRow>(
        `SELECT rule_id, name, enabled, sort_order FROM smart_sort_rule WHERE rule_id = 'user-mine'`
      );
      assert.equal(row.length, 1);
      assert.equal(row[0]?.name, "我的规则");
      assert.equal(row[0]?.sort_order, 9);
    } finally {
      await conn.close();
    }
  });

  it("附录 A 常量锁：四条 pattern 可编译、命中 example、捕获组提取正确", () => {
    for (const row of BUILTIN_SMART_SORT_RULE_ROWS) {
      const re = new RegExp(row.pattern, row.flags);
      assert.ok(
        re.test(row.example),
        `${row.ruleId} 应命中 example「${row.example}」`
      );
    }

    // 卷章复合：两捕获组分别提取卷号与章号（阿拉伯数字直取）。
    const vc = new RegExp(BUILTIN_SMART_SORT_RULE_ROWS[0]!.pattern);
    const vcMatch = "第2卷 第13章".match(vc);
    assert.ok(vcMatch != null);
    assert.equal(vcMatch[1], "2");
    assert.equal(vcMatch[2], "13");

    // 中文序号章节：捕获组为中文数字原文（数值转换是 Step 4 比较器的职责）。
    const zh = new RegExp(BUILTIN_SMART_SORT_RULE_ROWS[1]!.pattern);
    const zhMatch = "第十二章 风起".match(zh);
    assert.ok(zhMatch != null);
    assert.equal(zhMatch[1], "十二");

    // 英文章节：flags 'i' 支撑小写命中。
    const en = new RegExp(BUILTIN_SMART_SORT_RULE_ROWS[2]!.pattern, "i");
    const enMatch = "chapter 12".match(en);
    assert.ok(enMatch != null);
    assert.equal(enMatch[1], "12");

    // 数字序号开头：前导零捕获原文（001、→ '001'，Number() 后为 1）。
    const num = new RegExp(BUILTIN_SMART_SORT_RULE_ROWS[3]!.pattern);
    const numMatch = "001、开端".match(num);
    assert.ok(numMatch != null);
    assert.equal(numMatch[1], "001");

    // 前置必要性（附录 A 说明 1）：zh-chapter 单独命中「第2卷 第13章」只提卷号。
    const preemption = "第2卷 第13章".match(zh);
    assert.ok(preemption != null);
    assert.equal(preemption[1], "2");
  });
});
