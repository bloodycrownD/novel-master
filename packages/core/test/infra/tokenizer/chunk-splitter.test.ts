import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_CHUNK_CHARS,
  SOFT_BOUNDARY_CHARS,
  SENTENCE_END_CHARS,
  splitTextIntoChunks,
} from "../../../src/infra/tokenizer/logic/chunk-splitter.js";

/**
 * T-TC1：切分器 golden 快照 + 核心不变量。
 * golden 用例锁定版本行为（切分规则变更会改变期望输出，须显式改此文件）；
 * 不变量断言（join 还原 / ≤64 / 确定性）对任意输入恒成立。
 */

/** 不变量三连：join 还原原文、全块 ≤ 上限、同输入双调用一致。 */
function assertInvariants(text: string): string[] {
  const first = splitTextIntoChunks(text);
  const second = splitTextIntoChunks(text);
  assert.deepEqual(second, first, `确定性失败: ${text.slice(0, 40)}…`);
  assert.equal(first.join(""), text, `join("") 必须逐字节还原原文`);
  for (const chunk of first) {
    assert.ok(
      chunk.length <= MAX_CHUNK_CHARS,
      `块超上限(${chunk.length}): ${chunk.slice(0, 70)}…`,
    );
  }
  return first;
}

describe("chunk-splitter golden（T-TC1）", () => {
  it("中文正文：按句末符号切分，句号含入块尾", () => {
    const text = "夜色如水，林间小径落满枯叶。风一吹便沙沙作响！她停下了脚步？";
    assert.deepEqual(splitTextIntoChunks(text), [
      "夜色如水，林间小径落满枯叶。",
      "风一吹便沙沙作响！",
      "她停下了脚步？",
    ]);
  });

  it("连续句末贪吃：省略号与连续换行并入前块，不产空块", () => {
    assert.deepEqual(splitTextIntoChunks("等等……\n\n然后呢？"), [
      "等等……\n\n",
      "然后呢？",
    ]);
    assert.deepEqual(splitTextIntoChunks("。。。！！！"), ["。。。！！！"]);
  });

  it("英文与小数点/URL：句末符号照切，普通句点非句末不切", () => {
    // "." 不在句末集（避免 URL/小数点被当句子边界制造碎块），
    // "?" 与 "!" 在句末集。
    const text = "The value is 3.14 and see https://a.b/c. Got it? Yes!";
    assert.deepEqual(splitTextIntoChunks(text), [
      "The value is 3.14 and see https://a.b/c. Got it?",
      " Yes!",
    ]);
  });

  it("超限软边界回退：无句末符号时在块内最近标点切（含入块尾）", () => {
    // 70 个字符、无任何句末符号，唯一软边界是中位的顿号「、」
    const head = "甲".repeat(33);
    const tail = "乙".repeat(36);
    const text = `${head}、${tail}`;
    const chunks = assertInvariants(text);
    assert.deepEqual(chunks, [`${head}、`, tail]);
  });

  it("无任何边界硬切：无空白长中文串按 64 上限切（病态输入兜底）", () => {
    const n = 130;
    const text = "汉".repeat(n);
    const chunks = assertInvariants(text);
    assert.deepEqual(
      chunks.map((c) => c.length),
      [64, 64, 2],
    );
    // 10K 无空白串（真实库实测捕获过 10,697 字符样本）不变量仍成立
    const huge = "字".repeat(10_000);
    const hugeChunks = assertInvariants(huge);
    assert.equal(hugeChunks.length, Math.ceil(10_000 / MAX_CHUNK_CHARS));
  });

  it("代码与 JSON 形态：大括号/引号是软边界，字符串整体不被句末误切", () => {
    const text = '{"name":"工具","input":{"path":"章节/01.md","ok":true}}';
    const chunks = assertInvariants(text);
    // JSON 单行无句末符号：整体不超过 64 时保持单块
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], text);
  });

  it("混合长文：真实叙事形态的形态断言（首块以句末收尾）", () => {
    const sentence =
      "她推开门，屋内的灰尘在光柱里浮浮沉沉，像一场无声的雪。";
    const text = `${sentence}${sentence}${sentence}`;
    const chunks = assertInvariants(text);
    // 每句 28 字符：三句各自成块（句末优先于长度回退）
    assert.equal(chunks.length, 3);
    for (const chunk of chunks) {
      assert.ok("。".includes(chunk[chunk.length - 1]!));
    }
  });

  it("边界与空输入：空串返回空数组；单字符句末成块", () => {
    assert.deepEqual(splitTextIntoChunks(""), []);
    assert.deepEqual(splitTextIntoChunks("。"), ["。"]);
  });
});

describe("chunk-splitter 不变量（T-TC1 续）", () => {
  it("确定性：同文本双调用逐项相等（含随机混合语料）", () => {
    const mixed =
      "第一句。\nsecond line with spaces.\r\n第三句？！" +
      "、".repeat(80) +
      "无标点长串".repeat(20) +
      '{"json":true}最后一句。';
    assertInvariants(mixed);
  });

  it("边界集常量可寻址（供缓存层与测试引用）", () => {
    assert.ok(SENTENCE_END_CHARS.has("。"));
    assert.ok(!SENTENCE_END_CHARS.has("."));
    assert.ok(SOFT_BOUNDARY_CHARS.has("."));
    assert.ok(SOFT_BOUNDARY_CHARS.has("，"));
  });
});
