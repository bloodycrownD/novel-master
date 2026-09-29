/**
 * session prompt token store 单测：KKV 值编解码 + 热层/KKV 读写 + 双删。
 *
 * 覆盖：
 * - 编解码：损坏 / 缺字段 / 非法可选字段 → null 或省略该键；
 *   `atMs` 与 `promptTokens` 同为必填（缺任一当 miss），`promptTokens===0` 合法；
 * - 读：Map 热层优先、KKV miss → null、KKV 命中回填 Map（第二次不再查库）、
 *   读库抛错 → 按 miss 处理不抛；
 * - 写：Map + KKV 双写，KKV 抛错吞掉不冒泡；
 * - 失效：Map 与 KKV 行双删（键为 prompt_tokens / lastPromptUsage）。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  PROMPT_TOKENS_LAST_USAGE_KEY,
  SESSION_KKV_DOMAIN_PROMPT_TOKENS,
} from "../../../src/domain/session-kkv/model/session-kkv-domains.js";
import { sessionApiPromptTokenCache } from "../../../src/infra/tokenizer/logic/session-api-prompt-token-cache.js";
import {
  invalidateSessionApiPromptTokenEntry,
  parseSessionApiPromptTokenEntry,
  readSessionApiPromptTokenEntry,
  serializeSessionApiPromptTokenEntry,
  writeSessionApiPromptTokenEntry,
} from "../../../src/infra/tokenizer/logic/session-api-prompt-token-store.js";
import { createMemorySessionKkv } from "../../helpers/prompt-layout-test-helpers.js";

const SESSION_ID = "sess-prompt-token-store";

/** 包一层计数：记录 get/set/delete 的调用次数（验证热层回填后不再查库）。 */
function countingKkv() {
  const inner = createMemorySessionKkv();
  const calls = { get: 0, set: 0, delete: 0 };
  return {
    calls,
    kkv: {
      ...inner,
      async get(sessionId: string, domain: string, key: string) {
        calls.get += 1;
        return inner.get(sessionId, domain, key);
      },
      async set(
        sessionId: string,
        domain: string,
        key: string,
        value: string
      ) {
        calls.set += 1;
        return inner.set(sessionId, domain, key, value);
      },
      async delete(sessionId: string, domain: string, key: string) {
        calls.delete += 1;
        return inner.delete(sessionId, domain, key);
      },
    },
  };
}

describe("session-api-prompt-token-store 编解码", () => {
  it("全字段往返：promptTokens / atMs / savedModelId", () => {
    const raw = serializeSessionApiPromptTokenEntry({
      promptTokens: 12_729,
      atMs: 1_700_000_000_000,
      savedModelId: "openai/gpt-4o",
    });
    assert.deepEqual(parseSessionApiPromptTokenEntry(raw), {
      promptTokens: 12_729,
      atMs: 1_700_000_000_000,
      savedModelId: "openai/gpt-4o",
    });
  });

  it("anchorSeq 全链往返：序列化 → 解析 → 热层写/读都带着", async () => {
    const raw = serializeSessionApiPromptTokenEntry({
      promptTokens: 4_242,
      atMs: 1_700_000_000_000,
      savedModelId: "zai/glm-4.6",
      anchorSeq: 37,
    });
    assert.deepEqual(parseSessionApiPromptTokenEntry(raw), {
      promptTokens: 4_242,
      atMs: 1_700_000_000_000,
      savedModelId: "zai/glm-4.6",
      anchorSeq: 37,
    });

    // 写 → 热层 → 读：锚点必须穿透热层（读口增量估算靠它）。
    const { kkv } = countingKkv();
    sessionApiPromptTokenCache.clearAll();
    writeSessionApiPromptTokenEntry(kkv, "sess-anchor", {
      promptTokens: 4_242,
      atMs: 11,
      savedModelId: "zai/glm-4.6",
      anchorSeq: 37,
    });
    assert.equal(sessionApiPromptTokenCache.get("sess-anchor")?.anchorSeq, 37);
    assert.deepEqual(await readSessionApiPromptTokenEntry(kkv, "sess-anchor"), {
      promptTokens: 4_242,
      atMs: 11,
      savedModelId: "zai/glm-4.6",
      anchorSeq: 37,
    });
    // KKV 行也带着（跨重启续命）
    assert.equal(
      await kkv.get(
        "sess-anchor",
        SESSION_KKV_DOMAIN_PROMPT_TOKENS,
        PROMPT_TOKENS_LAST_USAGE_KEY
      ),
      JSON.stringify({
        promptTokens: 4_242,
        atMs: 11,
        savedModelId: "zai/glm-4.6",
        anchorSeq: 37,
      })
    );
    sessionApiPromptTokenCache.clearAll();
  });

  it("anchorSeq 非法（负数 / 非有限数 / 字符串）→ 序列化与解析都省略该键", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const raw = serializeSessionApiPromptTokenEntry({
        promptTokens: 7,
        atMs: 1,
        anchorSeq: bad,
      });
      assert.deepEqual(JSON.parse(raw), { promptTokens: 7, atMs: 1 });
    }
    assert.deepEqual(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({ promptTokens: 7, atMs: 1, anchorSeq: "37" })
      ),
      { promptTokens: 7, atMs: 1 }
    );
  });

  it("老行（无 anchorSeq 键）照常解析、不带锚点——读口 delta 按 0 处理", () => {
    const parsed = parseSessionApiPromptTokenEntry(
      JSON.stringify({ promptTokens: 100, atMs: 5, savedModelId: "zai/glm-4.6" })
    );
    assert.deepEqual(parsed, {
      promptTokens: 100,
      atMs: 5,
      savedModelId: "zai/glm-4.6",
    });
    assert.equal("anchorSeq" in (parsed ?? {}), false);
  });

  it("旧行多带已移除的可选加固字段：忽略未知键，照常解析不判 miss", () => {
    // 旧行可能还带着两个已移除的字段（run 身份、末尾消息 seq）。解析只解构
    // 已知键，所以老行必须照样解析出来（不报错、不判 miss）——字段移除因此
    // 不需要数据迁移或清库。这里用一个中立未知键表达同一件事。
    assert.deepEqual(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({
          promptTokens: 12_729,
          atMs: 1_700_000_000_000,
          savedModelId: "openai/gpt-4o",
          someRemovedLegacyKey: "whatever",
        })
      ),
      {
        promptTokens: 12_729,
        atMs: 1_700_000_000_000,
        savedModelId: "openai/gpt-4o",
      }
    );
  });

  it("只有两个必填字段（promptTokens / atMs）照常解析，指纹键省略", () => {
    const parsed = parseSessionApiPromptTokenEntry(
      JSON.stringify({ promptTokens: 100, atMs: 5 })
    );
    assert.deepEqual(parsed, { promptTokens: 100, atMs: 5 });
    assert.equal("savedModelId" in (parsed ?? {}), false);
  });

  it("非法可选字段被省略（不写进值，也不污染解析结果）", () => {
    const raw = serializeSessionApiPromptTokenEntry({
      promptTokens: 7,
      atMs: 1,
      savedModelId: "",
    });
    assert.deepEqual(JSON.parse(raw), { promptTokens: 7, atMs: 1 });
    assert.deepEqual(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({
          promptTokens: 7,
          atMs: 1,
          savedModelId: "",
        })
      ),
      { promptTokens: 7, atMs: 1 }
    );
  });

  it("损坏 / 缺失 / 非法必需字段 → null", () => {
    assert.equal(parseSessionApiPromptTokenEntry(null), null);
    assert.equal(parseSessionApiPromptTokenEntry(""), null);
    assert.equal(parseSessionApiPromptTokenEntry("{not json"), null);
    assert.equal(parseSessionApiPromptTokenEntry("[]"), null);
    assert.equal(parseSessionApiPromptTokenEntry("null"), null);
    assert.equal(
      parseSessionApiPromptTokenEntry(JSON.stringify({ atMs: 1 })),
      null
    );
    assert.equal(
      parseSessionApiPromptTokenEntry(JSON.stringify({ promptTokens: "x" })),
      null
    );
    assert.equal(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({ promptTokens: Number.NaN })
      ),
      null
    );
    assert.equal(
      parseSessionApiPromptTokenEntry(JSON.stringify({ promptTokens: -1 })),
      null
    );
    // atMs 与 promptTokens 同为必填：缺失 / 类型不对 / 非有限数一律当 miss
    // （退化 0 会让时效判据把它当「永远过期」，或被 ===0 守卫静默放行）。
    assert.equal(
      parseSessionApiPromptTokenEntry(JSON.stringify({ promptTokens: 3 })),
      null
    );
    assert.equal(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({ promptTokens: 3, atMs: "5" })
      ),
      null
    );
    assert.equal(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({ promptTokens: 3, atMs: null })
      ),
      null
    );
    assert.equal(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({ promptTokens: 3, atMs: Number.NaN })
      ),
      null
    );
    // promptTokens === 0 本身是合法值，仍放行（不被 atMs 校验顺手一起拒）。
    assert.deepEqual(
      parseSessionApiPromptTokenEntry(
        JSON.stringify({ promptTokens: 0, atMs: 7 })
      ),
      { promptTokens: 0, atMs: 7 }
    );
  });
});

describe("session-api-prompt-token-store 读取", () => {
  beforeEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("KKV miss 且热层 miss → null", async () => {
    const { kkv } = countingKkv();
    assert.equal(await readSessionApiPromptTokenEntry(kkv, SESSION_ID), null);
  });

  it("热层命中不查库；KKV 命中回填热层后第二次不再查库", async () => {
    const { calls, kkv } = countingKkv();
    await kkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      serializeSessionApiPromptTokenEntry({ promptTokens: 555, atMs: 9 })
    );

    const first = await readSessionApiPromptTokenEntry(kkv, SESSION_ID);
    assert.deepEqual(first, { promptTokens: 555, atMs: 9 });
    assert.equal(calls.get, 1);

    const second = await readSessionApiPromptTokenEntry(kkv, SESSION_ID);
    assert.deepEqual(second, { promptTokens: 555, atMs: 9 });
    assert.equal(calls.get, 1, "回填热层后不应再查库");
  });

  it("KKV 行损坏 → null（当 miss，不抛）", async () => {
    const { kkv } = countingKkv();
    await kkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      "{broken"
    );
    assert.equal(await readSessionApiPromptTokenEntry(kkv, SESSION_ID), null);
  });

  it("读库抛错 → 按 miss 返回 null，不冒泡", async () => {
    const kkv = {
      ...createMemorySessionKkv(),
      async get(): Promise<string | null> {
        throw new Error("db down");
      },
    };
    assert.equal(await readSessionApiPromptTokenEntry(kkv, SESSION_ID), null);
  });

  it("sessionKkv 缺省时退化为纯热层读（旧调用方行为不变）", async () => {
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 321,
      updatedAt: 7,
    });
    assert.deepEqual(
      await readSessionApiPromptTokenEntry(undefined, SESSION_ID),
      { promptTokens: 321, atMs: 7 }
    );
    sessionApiPromptTokenCache.clearAll();
    assert.equal(await readSessionApiPromptTokenEntry(null, SESSION_ID), null);
  });
});

describe("session-api-prompt-token-store 写入与失效", () => {
  beforeEach(() => {
    sessionApiPromptTokenCache.clearAll();
  });

  it("写：热层立即可读且 KKV 行带上可选指纹", async () => {
    const { kkv } = countingKkv();
    writeSessionApiPromptTokenEntry(kkv, SESSION_ID, {
      promptTokens: 1_234,
      atMs: 11,
      savedModelId: "openai/gpt-4o",
    });

    assert.equal(
      sessionApiPromptTokenCache.get(SESSION_ID)?.promptTokens,
      1_234,
      "热层同步写"
    );
    assert.equal(
      sessionApiPromptTokenCache.get(SESSION_ID)?.savedModelId,
      "openai/gpt-4o",
      "热层透传指纹"
    );
    const raw = await kkv.get(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY
    );
    assert.equal(
      raw,
      JSON.stringify({
        promptTokens: 1_234,
        atMs: 11,
        savedModelId: "openai/gpt-4o",
      })
    );
  });

  it("写：KKV set 抛错只吞掉（热层仍写成功）", async () => {
    const kkv = {
      ...createMemorySessionKkv(),
      async set(): Promise<void> {
        throw new Error("disk full");
      },
    };
    writeSessionApiPromptTokenEntry(kkv, SESSION_ID, {
      promptTokens: 9,
      atMs: 1,
    });
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID)?.promptTokens, 9);
    // 等一个微任务，unhandled rejection 不应冒出来（node:test 会把它算失败）
    await Promise.resolve();
    await Promise.resolve();
  });

  it("失效：热层与 KKV 行双删（跨重启不复活）", async () => {
    const { calls, kkv } = countingKkv();
    await kkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_PROMPT_TOKENS,
      PROMPT_TOKENS_LAST_USAGE_KEY,
      serializeSessionApiPromptTokenEntry({ promptTokens: 888, atMs: 1 })
    );
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 888,
      updatedAt: 1,
    });

    await invalidateSessionApiPromptTokenEntry(kkv, SESSION_ID);

    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);
    assert.equal(calls.delete, 1);
    assert.equal(
      await kkv.get(
        SESSION_ID,
        SESSION_KKV_DOMAIN_PROMPT_TOKENS,
        PROMPT_TOKENS_LAST_USAGE_KEY
      ),
      null
    );
  });

  it("失效：KKV delete 抛错只吞掉（热层已清）", async () => {
    const kkv = {
      ...createMemorySessionKkv(),
      async delete(): Promise<void> {
        throw new Error("db locked");
      },
    };
    sessionApiPromptTokenCache.set(SESSION_ID, {
      promptTokens: 1,
      updatedAt: 1,
    });
    await invalidateSessionApiPromptTokenEntry(kkv, SESSION_ID);
    assert.equal(sessionApiPromptTokenCache.get(SESSION_ID), undefined);
    await Promise.resolve();
    await Promise.resolve();
  });
});
