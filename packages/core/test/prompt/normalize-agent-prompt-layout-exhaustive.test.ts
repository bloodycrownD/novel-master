/**
 * 白名单完整性穷举守卫（wave-e H2）。
 *
 * 与 `normalize-agent-prompt-layout.test.ts` 里 Wave B 补的「键集回归锁」分工：
 * 那条锁的是**已知 7 个字段**的键集往返（对「删改已有 spread」有牙），
 * 本文件锁的是**字段全集的穷举性**（对「新增字段忘了加白名单」有牙）——
 * 用例输入由 `NORMALIZED_OPTIONAL_FIELDS` 驱动，**不再硬编码字段名**。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNormalizeCoversAllFields,
  NORMALIZED_OPTIONAL_FIELDS,
  NORMALIZE_FIELD_SENTINELS,
  normalizeAgentPromptLayoutDomain,
} from "../../src/domain/prompt/logic/normalize-agent-prompt-layout.js";
import type { NormalizedOptionalField } from "../../src/domain/prompt/logic/normalize-agent-prompt-layout.js";

const OPTIONAL_FIELDS = Object.keys(
  NORMALIZED_OPTIONAL_FIELDS,
) as NormalizedOptionalField[];

describe("normalize 白名单完整性：字段全集（wave-e H2）", () => {
  it("两张表（键表 / 哨兵表）键集必须一致", () => {
    // 键表与哨兵表是分开的两个常量：只加其中一边就会漂移，这里把它钉死。
    assert.deepEqual(
      OPTIONAL_FIELDS.slice().sort(),
      Object.keys(NORMALIZE_FIELD_SENTINELS).sort(),
    );
    assert.ok(
      OPTIONAL_FIELDS.length >= 7,
      `可选字段表被削到 ${OPTIONAL_FIELDS.length} 项，比已知下限 7 还少 —— 常量表被改坏了。`,
    );
  });

  it("全字段 layout 经 normalize 后逐字段保值（由字段表驱动，不硬编码）", () => {
    // 主用例：所有可选字段都取哨兵值，一次 normalize 后逐键比对。
    // 牙齿自检：删掉 normalize 里 skillsEnabled 那条 spread ⇒ 本用例红；
    //   新增第 8 个字段时只要补进两张表，就自动进入断言面，不必改本文件。
    const normalized = normalizeAgentPromptLayoutDomain({
      ...NORMALIZE_FIELD_SENTINELS,
      persist: [],
      dynamic: [],
    });
    for (const field of OPTIONAL_FIELDS) {
      assert.equal(
        normalized[field],
        NORMALIZE_FIELD_SENTINELS[field],
        `字段 ${field} 经 normalize 后没有原样保值（漏了 spread，或省略条件写反了）`,
      );
    }
  });

  it("单字段独立验证：只塞一个字段时该字段必须回吐", () => {
    // 逐字段单独跑一遍：防止「A 的 spread 误写了 B 的键值」这类互相掩盖的错误
    // （上一条全字段夹具里同时塞了所有哨兵，一次误写可能恰好被另一处兜住）。
    for (const field of OPTIONAL_FIELDS) {
      const normalized = normalizeAgentPromptLayoutDomain({
        [field]: NORMALIZE_FIELD_SENTINELS[field],
        persist: [],
        dynamic: [],
      } as Parameters<typeof normalizeAgentPromptLayoutDomain>[0]);
      assert.equal(
        normalized[field],
        NORMALIZE_FIELD_SENTINELS[field],
        `单独塞 ${field} 时没有回吐：normalize 的 ${field} 分支可能挂到了别的字段上`,
      );
    }
  });

  it("缺省字段不被写入（输出键集恰为 persist / dynamic）", () => {
    // 牙齿自检：把某个 `layoutHasX` 判断写成恒真 ⇒ 空值会被写进结果 ⇒ 键集多出该项 ⇒ 红。
    const normalized = normalizeAgentPromptLayoutDomain({
      persist: [],
      dynamic: [],
    });
    assert.deepEqual(Object.keys(normalized).sort(), ["dynamic", "persist"]);
  });

  it("assertNormalizeCoversAllFields 不抛", () => {
    assert.doesNotThrow(() => {
      assertNormalizeCoversAllFields();
    });
  });
});
