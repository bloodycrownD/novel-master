import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeForMatch } from "../../src/domain/vfs/logic/normalize-for-match.js";

/** 弯引号常量，方便用例阅读。 */
const LDQ = "\u201C"; // “
const RDQ = "\u201D"; // ”
const LSQ = "\u2018"; // ‘
const RSQ = "\u2019"; // ’
/** 日式引号常量。 */
const LCB = "\u300C"; // 「
const RCB = "\u300D"; // 」
const LWCB = "\u300E"; // 『
const RWCB = "\u300F"; // 』
/** 全角空格。 */
const IDSP = "\u3000";

describe("normalizeForMatch 字符族映射（v1 全部 1:1）", () => {
  it("弯双引号 → 直双引号", () => {
    assert.equal(normalizeForMatch(`${LDQ}x${RDQ}`), `"x"`);
  });

  it("弯单引号 → 直单引号", () => {
    assert.equal(normalizeForMatch(`${LSQ}x${RSQ}`), `'x'`);
  });

  it("日式角引号「」 → 直双引号", () => {
    assert.equal(normalizeForMatch(`${LCB}x${RCB}`), `"x"`);
  });

  it("日式白角引号『』 → 直单引号", () => {
    assert.equal(normalizeForMatch(`${LWCB}x${RWCB}`), `'x'`);
  });

  it("全角空格 → 半角空格", () => {
    assert.equal(normalizeForMatch(`a${IDSP}b`), "a b");
  });

  it("无映射字符原样透传（中文、ASCII、代理对）", () => {
    assert.equal(normalizeForMatch("普通中文 abc 123"), "普通中文 abc 123");
    assert.equal(normalizeForMatch("emoji 👨‍👩‍👧 end"), "emoji 👨‍👩‍👧 end");
  });

  it("混合场景：弯引号 + 日式引号 + 全角空格一起归一化", () => {
    const input = `${LDQ}你${IDSP}好${RDQ}${LCB}嗨${RCB}`;
    assert.equal(normalizeForMatch(input), `"你 好"「嗨」`.replace(/「|」/g, '"'));
    // 更直观：日式角引号也归一到直双引号
    assert.equal(normalizeForMatch(input), `"你 好""嗨"`);
  });
});

describe("normalizeForMatch 不变量（v1 严格 1:1）", () => {
  it("归一化前后码点数严格相等（Array.from 视角）", () => {
    const samples = [
      `${LDQ}${RDQ}${LSQ}${RSQ}`,
      `${LCB}${RCB}${LWCB}${RWCB}`,
      `a${IDSP}b`,
      "普通中文",
      `emoji ${LWCB}👨‍👩‍👧${RWCB} end`,
    ];
    for (const s of samples) {
      assert.equal(
        Array.from(normalizeForMatch(s)).length,
        Array.from(s).length,
        `码点数变了: ${s}`,
      );
    }
  });

  it("归一化前后 UTF-16 码元数严格相等（length 视角）", () => {
    // 所有映射字符都是 BMP 内单码点，代理对原样透传，
    // 所以 UTF-16 码元层面也严格 1:1，index 可直接通用。
    const samples = [
      `${LDQ}${RDQ}${LSQ}${RSQ}`,
      `${LCB}${RCB}${LWCB}${RWCB}`,
      `a${IDSP}b`,
      "普通中文",
      `emoji ${LWCB}👨‍👩‍👧${RWCB} end`,
    ];
    for (const s of samples) {
      assert.equal(normalizeForMatch(s).length, s.length, `UTF-16 码元数变了: ${s}`);
    }
  });

  it("空串归一化仍为空串", () => {
    assert.equal(normalizeForMatch(""), "");
  });
});

describe("normalizeForMatch v1 边界（省略号不归一化）", () => {
  it("省略号 …… 原样保留（N:1 映射推迟 v2）", () => {
    // 中文省略号 ……（U+2026 ×2）不归一化，原样透传。
    assert.equal(normalizeForMatch("等一下……"), "等一下……");
    assert.equal(normalizeForMatch("..."), "...");
    // 两者归一化后仍然不相等，所以 v1 在 compute-replace-result 里不命中。
    assert.notEqual(normalizeForMatch("……"), normalizeForMatch("..."));
  });
});
