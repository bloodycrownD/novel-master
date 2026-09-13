/**
 * validateVfsEntryName 单测：拍板规则的拒绝用例（控制字符、NUL、纯空白、
 * 首尾空格、`.`/`..`）与放行用例（中文、中间空格、括号、标点、emoji、全角）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateVfsEntryName } from "../../../src/domain/vfs/logic/validate-entry-name.js";

describe("validateVfsEntryName", () => {
  describe("拒绝", () => {
    it("换行符（\\n / \\r / \\r\\n）", () => {
      assert.deepEqual(validateVfsEntryName("第\n2章"), {
        ok: false,
        reason: "文件名不能包含换行或控制字符",
      });
      assert.equal(validateVfsEntryName("第\r2章").ok, false);
      assert.equal(validateVfsEntryName("a\r\nb").ok, false);
    });

    it("制表符与其它 C0 控制字符", () => {
      assert.equal(validateVfsEntryName("a\tb").ok, false);
      assert.equal(validateVfsEntryName("a\u0000b").ok, false);
      assert.equal(validateVfsEntryName("\u0001").ok, false);
      assert.equal(validateVfsEntryName("结尾\u001f").ok, false);
    });

    it("DEL 与 C1 控制字符（U+007F / U+0080–U+009F）", () => {
      assert.equal(validateVfsEntryName("a\u007fb").ok, false);
      assert.equal(validateVfsEntryName("a\u0085b").ok, false);
      assert.equal(validateVfsEntryName("a\u009fb").ok, false);
    });

    it("纯空白名（空串 / 空格 / 全角空格 / 混合）", () => {
      assert.deepEqual(validateVfsEntryName(""), {
        ok: false,
        reason: "文件名不能为空或纯空白",
      });
      assert.equal(validateVfsEntryName("   ").ok, false);
      assert.equal(validateVfsEntryName("\u3000").ok, false);
      assert.equal(validateVfsEntryName(" \u3000\t ").ok, false);
    });

    it("首尾空格（半角与全角）", () => {
      assert.deepEqual(validateVfsEntryName(" 第2章"), {
        ok: false,
        reason: "文件名不能以空格开头或结尾",
      });
      assert.equal(validateVfsEntryName("第2章 ").ok, false);
      assert.equal(validateVfsEntryName("　第2章").ok, false);
      assert.equal(validateVfsEntryName("第2章\u3000").ok, false);
    });

    it(". 与 ..", () => {
      assert.deepEqual(validateVfsEntryName("."), {
        ok: false,
        reason: "文件名不能为 . 或 ..",
      });
      assert.equal(validateVfsEntryName("..").ok, false);
    });
  });

  describe("放行", () => {
    it("中文名与中文标点", () => {
      assert.deepEqual(validateVfsEntryName("第一章：开端"), { ok: true });
      assert.deepEqual(validateVfsEntryName("番外·婚礼"), { ok: true });
      assert.deepEqual(validateVfsEntryName("《主线》"), { ok: true });
    });

    it("中间空格与数字序号", () => {
      assert.deepEqual(validateVfsEntryName("第 2 章"), { ok: true });
      assert.deepEqual(validateVfsEntryName("Chapter 3 Draft"), { ok: true });
      assert.deepEqual(validateVfsEntryName("⑫⑬"), { ok: true });
    });

    it("括号、方头括号与英文标点", () => {
      assert.deepEqual(validateVfsEntryName("【大纲】"), { ok: true });
      assert.deepEqual(validateVfsEntryName("设定(草稿)"), { ok: true });
      assert.deepEqual(validateVfsEntryName("notes_v2.final"), { ok: true });
      assert.deepEqual(validateVfsEntryName("a&b=c?d!e"), { ok: true });
    });

    it("emoji 与全角字符", () => {
      assert.deepEqual(validateVfsEntryName("草稿📝"), { ok: true });
      assert.deepEqual(validateVfsEntryName("ＦＵＬＬ－ＷＩＤＴＨ"), {
        ok: true,
      });
      assert.deepEqual(validateVfsEntryName("！？…—"), { ok: true });
    });

    it("普通 ASCII 与混合", () => {
      assert.deepEqual(validateVfsEntryName("outline.md"), { ok: true });
      assert.deepEqual(validateVfsEntryName("章2-v3 (修).txt"), { ok: true });
    });
  });
});
