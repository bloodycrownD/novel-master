/**
 * sort-rule CLI e2e (T-CLI1)：种子内置规则、test 排序输出、builtin 保护。
 *
 * @module test/sort-rule-e2e
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runNm } from "./helpers.js";

describe("sort-rule CLI e2e", () => {
  it("list 列出七条内置规则且 TSV 可解析（capture 列在 enabled 后，D13）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sort-rule-"));
    const dbPath = join(dir, "novel.db");
    try {
      const res = runNm(["sort-rule", "list", "--db", dbPath]);
      assert.equal(res.status, 0, res.stderr);
      // 不用 helpers 的 stripBootLogs：其末尾 trim 会吃掉末行行尾的空 flags 列分隔 tab
      const rows = res.stdout
        .split("\n")
        .filter((line) => line && !line.startsWith("[nm-boot]"))
        .map((line) => line.split("\t"));
      assert.equal(rows.length, 7);
      for (const cols of rows) {
        assert.equal(cols.length, 7);
        assert.match(cols[1]!, /^builtin-/);
      }
      assert.deepEqual(
        rows.map((c) => c[1]),
        [
          "builtin-zh-prologue",
          "builtin-zh-finale",
          "builtin-zh-extra",
          "builtin-zh-volume-chapter",
          "builtin-zh-chapter",
          "builtin-en-chapter",
          "builtin-numeric",
        ],
      );
      // 列序钉死：order⇥id⇥enabled⇥capture⇥flags⇥name⇥pattern（D13 后
      // capture 插在 enabled 后）。用 builtin-en-chapter（flags='i'、smart）
      // 与 builtin-zh-prologue（fixed_min）钉死各列位置。
      const enChapter = rows.find((c) => c[1] === "builtin-en-chapter")!;
      assert.equal(enChapter[0], "6");
      assert.equal(enChapter[2], "1");
      assert.equal(enChapter[3], "smart");
      assert.equal(enChapter[4], "i");
      assert.equal(enChapter[5], "英文章节");
      assert.match(enChapter[6]!, /^\(\?:chapter/);
      const prologue = rows.find((c) => c[1] === "builtin-zh-prologue")!;
      assert.equal(prologue[0], "1");
      assert.equal(prologue[3], "fixed_min");
      // 其余内置规则 flags 为空：空 flags 列不吞分隔 tab。
      assert.equal(rows.find((c) => c[1] === "builtin-numeric")![4], "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 输出命中明细与排序后顺序（第一章/第二章/第十章）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sort-rule-test-"));
    const dbPath = join(dir, "novel.db");
    try {
      const res = runNm([
        "sort-rule",
        "test",
        "第一章.txt",
        "第十章.txt",
        "第二章.txt",
        "--db",
        dbPath,
      ]);
      assert.equal(res.status, 0, res.stderr);
      // 剥掉末尾换行后仅过滤 [nm-boot] 行，保留中间空行分隔（trim 会吃末行尾 tab）
      const lines = res.stdout
        .replace(/\n$/, "")
        .split("\n")
        .filter((line) => !line.startsWith("[nm-boot]"));
      // 明细段：文件名⇥命中规则id⇥序号元组（未命中 -）
      const detail = lines.slice(0, 3).map((line) => line.split("\t"));
      for (const cols of detail) {
        assert.equal(cols.length, 3);
        assert.equal(cols[1], "builtin-zh-chapter");
      }
      const nums = detail.map((c) => c[2]);
      assert.deepEqual(nums, ["1", "10", "2"]);
      // 空行 + 排序后顺序 + 末行标记
      assert.equal(lines[3], "");
      assert.deepEqual(lines.slice(4, 7), [
        "第一章.txt",
        "第二章.txt",
        "第十章.txt",
      ]);
      assert.equal(lines[lines.length - 1], "# asc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test 输出固定档哨兵文案与排序后顺序（D13：序章最前、番外/终章沉底决胜）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sort-rule-fixed-"));
    const dbPath = join(dir, "novel.db");
    try {
      const res = runNm([
        "sort-rule",
        "test",
        "终章.txt",
        "第十章.txt",
        "序章.txt",
        "番外.txt",
        "第一章.txt",
        "--db",
        dbPath,
      ]);
      assert.equal(res.status, 0, res.stderr);
      const lines = res.stdout
        .replace(/\n$/, "")
        .split("\n")
        .filter((line) => !line.startsWith("[nm-boot]"));
      const detail = lines.slice(0, 5).map((line) => line.split("\t"));
      const detailByName = new Map(detail.map((c) => [c[0], c]));
      assert.equal(detailByName.get("序章.txt")![1], "builtin-zh-prologue");
      assert.equal(detailByName.get("序章.txt")![2], "固定最小");
      assert.equal(detailByName.get("终章.txt")![2], "固定最大");
      assert.equal(detailByName.get("番外.txt")![2], "固定最大");
      assert.equal(detailByName.get("第一章.txt")![2], "1");
      // 排序：序章(-∞) → 第一章(1) → 第十章(10) → 番外/终章(+∞ 同值，
      // 文件名决胜：「番」U+756A <「终」U+7EC8 → 番外在前，D13 定稿锁行为）。
      assert.equal(lines[5], "");
      assert.deepEqual(lines.slice(6, 11), [
        "序章.txt",
        "第一章.txt",
        "第十章.txt",
        "番外.txt",
        "终章.txt",
      ]);
      assert.equal(lines[lines.length - 1], "# asc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("create/update --capture-kind 落库且非法值报错（D13）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sort-rule-kind-"));
    const dbPath = join(dir, "novel.db");
    try {
      // fixed_min + 无捕获组：合法（D13 fixed 档不强制捕获组）。
      const created = runNm([
        "sort-rule",
        "create",
        "--name",
        "序章类",
        "--pattern",
        "^序章",
        "--capture-kind",
        "fixed_min",
        "--db",
        dbPath,
      ]);
      assert.equal(created.status, 0, created.stderr);
      const ruleId = created.stdout
        .split("\n")
        .filter((line) => line && !line.startsWith("[nm-boot]"))
        .join("");

      const listed = runNm(["sort-rule", "list", "--db", dbPath]);
      const row = listed.stdout
        .split("\n")
        .filter((line) => line.startsWith(`${8}\t${ruleId}`));
      assert.equal(row.length, 1, "新规则应落在第 8 位");
      assert.equal(row[0]!.split("\t")[3], "fixed_min");

      // update 切档。
      const updated = runNm([
        "sort-rule",
        "update",
        "--id",
        ruleId,
        "--capture-kind",
        "fixed_max",
        "--db",
        dbPath,
      ]);
      assert.equal(updated.status, 0, updated.stderr);
      const relisted = runNm(["sort-rule", "list", "--db", dbPath]);
      assert.equal(
        relisted.stdout
          .split("\n")
          .filter((line) => line.startsWith(`${8}\t${ruleId}`))[0]!
          .split("\t")[3],
        "fixed_max",
      );

      // 非法档位报错非零退出。
      const bogus = runNm([
        "sort-rule",
        "create",
        "--name",
        "bad",
        "--pattern",
        "(\\d+)",
        "--capture-kind",
        "bogus",
        "--db",
        dbPath,
      ]);
      assert.notEqual(bogus.status, 0);
      assert.match(bogus.stderr, /invalid --capture-kind/);

      // 缺省 smart：零捕获组被拒（smart 档校验不变）。
      const zeroGroup = runNm([
        "sort-rule",
        "create",
        "--name",
        "bad2",
        "--pattern",
        "^序章",
        "--db",
        dbPath,
      ]);
      assert.notEqual(zeroGroup.status, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("move --to N 为 1 基位次：--to 1 落第一位，--to 0 报错非零退出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sort-rule-move-"));
    const dbPath = join(dir, "novel.db");
    try {
      // builtin-en-chapter 原在第 6 位；--to 1 应把它落到第一位（与 list 的 order 列口径一致）。
      const moved = runNm([
        "sort-rule",
        "move",
        "--id",
        "builtin-en-chapter",
        "--to",
        "1",
        "--db",
        dbPath,
      ]);
      assert.equal(moved.status, 0, moved.stderr);
      const outRows = moved.stdout
        .split("\n")
        .filter((line) => line && !line.startsWith("[nm-boot]"))
        .map((line) => line.split("\t"));
      assert.equal(outRows.length, 7);
      assert.equal(outRows[0]![0], "1");
      assert.equal(outRows[0]![1], "builtin-en-chapter");
      // move 后整表 sort_order 连续 1..7，原前五条顺延。
      assert.deepEqual(
        outRows.map((c) => c[1]),
        [
          "builtin-en-chapter",
          "builtin-zh-prologue",
          "builtin-zh-finale",
          "builtin-zh-extra",
          "builtin-zh-volume-chapter",
          "builtin-zh-chapter",
          "builtin-numeric",
        ],
      );

      // --to 0 是 1 基口径下的非法位次：报 invalid 而非静默被 core clamp 到首位。
      const zero = runNm([
        "sort-rule",
        "move",
        "--id",
        "builtin-numeric",
        "--to",
        "0",
        "--db",
        dbPath,
      ]);
      assert.notEqual(zero.status, 0);
      assert.match(zero.stderr, /invalid --to/);
      assert.match(zero.stderr, /1 基位次/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("remove 对 builtin- 前缀拒绝且退出非零；用户规则可删", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sort-rule-rm-"));
    const dbPath = join(dir, "novel.db");
    try {
      const builtin = runNm([
        "sort-rule",
        "remove",
        "--id",
        "builtin-zh-chapter",
        "--db",
        dbPath,
      ]);
      assert.notEqual(builtin.status, 0);
      assert.match(builtin.stderr, /builtin-/);

      const created = runNm([
        "sort-rule",
        "create",
        "--name",
        "用户规则",
        "--pattern",
        "第([0-9]+)话",
        "--description",
        "匹配 第X话 序号",
        "--db",
        dbPath,
      ]);
      assert.equal(created.status, 0, created.stderr);
      const ruleId = created.stdout
        .split("\n")
        .filter((line) => line && !line.startsWith("[nm-boot]"))
        .join("");
      assert.match(ruleId, /^rule-/);

      // update --description 可改描述（fix ④：--example 改名 --description）。
      const updated = runNm([
        "sort-rule",
        "update",
        "--id",
        ruleId,
        "--description",
        "新描述",
        "--db",
        dbPath,
      ]);
      assert.equal(updated.status, 0, updated.stderr);

      const removed = runNm([
        "sort-rule",
        "remove",
        "--id",
        ruleId,
        "--db",
        dbPath,
      ]);
      assert.equal(removed.status, 0, removed.stderr);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
