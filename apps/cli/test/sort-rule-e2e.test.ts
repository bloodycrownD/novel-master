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
  it("list 列出四条内置规则且 TSV 可解析", async () => {
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
      assert.equal(rows.length, 4);
      for (const cols of rows) {
        assert.equal(cols.length, 6);
        assert.match(cols[1]!, /^builtin-/);
      }
      assert.deepEqual(
        rows.map((c) => c[1]),
        [
          "builtin-zh-volume-chapter",
          "builtin-zh-chapter",
          "builtin-en-chapter",
          "builtin-numeric",
        ],
      );
      // 列序按 spec Step 9 钉死：order⇥id⇥enabled⇥flags⇥name⇥pattern。
      // 用 builtin-en-chapter（flags='i'）钉死 flags 在第 4 列、name/pattern 随后。
      const enChapter = rows.find((c) => c[1] === "builtin-en-chapter")!;
      assert.equal(enChapter[0], "3");
      assert.equal(enChapter[2], "1");
      assert.equal(enChapter[3], "i");
      assert.equal(enChapter[4], "英文章节");
      assert.match(enChapter[5]!, /^\(\?:chapter/);
      // 其余内置规则 flags 为空：空 flags 列不吞分隔 tab。
      assert.equal(rows.find((c) => c[1] === "builtin-numeric")![3], "");
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

  it("move --to N 为 1 基位次：--to 1 落第一位，--to 0 报错非零退出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nm-sort-rule-move-"));
    const dbPath = join(dir, "novel.db");
    try {
      // builtin-en-chapter 原在第 3 位；--to 1 应把它落到第一位（与 list 的 order 列口径一致）。
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
      assert.equal(outRows.length, 4);
      assert.equal(outRows[0]![0], "1");
      assert.equal(outRows[0]![1], "builtin-en-chapter");
      // move 后整表 sort_order 连续 1..4，原首位 volume-chapter 顺延第二。
      assert.deepEqual(
        outRows.map((c) => c[1]),
        [
          "builtin-en-chapter",
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
