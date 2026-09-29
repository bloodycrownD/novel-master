/**
 * L1 整串缓存（prompt-whole-cache）单测。
 *
 * 覆盖：命中返回；内容指纹 / 计数器身份变化即 miss；会话级 LRU 32 条
 * （最旧淘汰、命中提升新鲜度）；clearSession；stats / clearForTests；
 * KKV 持久化（record 收集 → persistPendingWrites 落库 → 重启 seedFromKkv
 * 续命；只收精确档；无变化不写库）。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SessionKkvService } from "../../../src/service/session-kkv/session-kkv.port.js";
import {
  PROMPT_WHOLE_CACHE_LRU_PER_SESSION,
  promptWholeCache,
} from "../../../src/infra/tokenizer/logic/prompt-whole-cache.js";

const SESSION_ID = "sess-l1";
const SCOPE = "vendor/m:tk:auto:node";
const ENTRY = {
  tokenCount: 12_345,
  counterKind: "tiktoken" as const,
  estimated: true,
};

function contentKey(n: number): string {
  return `hash-${n.toString().padStart(4, "0")}`;
}

/** 16-hex 内容指纹（与 chunkHash16 同形）。 */
function hex16(n: number): string {
  return n.toString(16).padStart(16, "0");
}

/** 内存假 KKV：记录 set 调用次数以断言「无变化不写库」。 */
function createFakeKkv(): SessionKkvService & { setCalls: number } {
  const store = new Map<string, string>();
  return {
    setCalls: 0,
    async get(sessionId, domain, key) {
      return store.get(`${sessionId}#${domain}#${key}`) ?? null;
    },
    async set(sessionId, domain, key, value) {
      this.setCalls += 1;
      store.set(`${sessionId}#${domain}#${key}`, value);
    },
  } as SessionKkvService & { setCalls: number };
}

describe("prompt-whole-cache（L1 整串缓存）", () => {
  beforeEach(() => {
    promptWholeCache.clearForTests();
  });

  it("record 后 lookup 命中返回完整口径三件套", () => {
    promptWholeCache.record(SESSION_ID, SCOPE, contentKey(1), ENTRY);
    assert.deepEqual(
      promptWholeCache.lookup(SESSION_ID, SCOPE, contentKey(1)),
      ENTRY
    );
  });

  it("内容指纹或计数器身份变化即 miss（无脏读）", () => {
    promptWholeCache.record(SESSION_ID, SCOPE, contentKey(1), ENTRY);
    assert.equal(
      promptWholeCache.lookup(SESSION_ID, SCOPE, contentKey(2)),
      undefined,
      "内容变化（新指纹）→ miss"
    );
    assert.equal(
      promptWholeCache.lookup(SESSION_ID, "other-scope", contentKey(1)),
      undefined,
      "换模型（新身份）→ miss"
    );
    assert.equal(
      promptWholeCache.lookup("other-session", SCOPE, contentKey(1)),
      undefined,
      "跨会话不共享 L1"
    );
  });

  it("会话级 LRU：第 33 条写入淘汰最旧一条；被命中过的条目存活更久", () => {
    // 灌满 32 条
    for (let i = 1; i <= PROMPT_WHOLE_CACHE_LRU_PER_SESSION; i += 1) {
      promptWholeCache.record(SESSION_ID, SCOPE, contentKey(i), ENTRY);
    }
    // 命中第 1 条：提升新鲜度，脱离最旧端
    assert.notEqual(
      promptWholeCache.lookup(SESSION_ID, SCOPE, contentKey(1)),
      undefined
    );
    // 再写 1 条：最旧端此刻是第 2 条（第 1 条已被提升）
    promptWholeCache.record(
      SESSION_ID,
      SCOPE,
      contentKey(PROMPT_WHOLE_CACHE_LRU_PER_SESSION + 1),
      ENTRY
    );
    assert.equal(
      promptWholeCache.stats().entries,
      PROMPT_WHOLE_CACHE_LRU_PER_SESSION,
      "会话桶条数恒 ≤ 上限"
    );
    assert.notEqual(
      promptWholeCache.lookup(SESSION_ID, SCOPE, contentKey(1)),
      undefined,
      "命中提升过的条目不淘汰"
    );
    assert.equal(
      promptWholeCache.lookup(SESSION_ID, SCOPE, contentKey(2)),
      undefined,
      "未被触碰的最旧条目被淘汰"
    );
    assert.notEqual(
      promptWholeCache.lookup(
        SESSION_ID,
        SCOPE,
        contentKey(PROMPT_WHOLE_CACHE_LRU_PER_SESSION + 1)
      ),
      undefined,
      "最新条目保留"
    );
  });

  it("覆盖写：同键重写取最新值", () => {
    promptWholeCache.record(SESSION_ID, SCOPE, contentKey(1), ENTRY);
    promptWholeCache.record(SESSION_ID, SCOPE, contentKey(1), {
      tokenCount: 99,
      counterKind: "heuristic",
      estimated: true,
    });
    assert.deepEqual(
      promptWholeCache.lookup(SESSION_ID, SCOPE, contentKey(1)),
      { tokenCount: 99, counterKind: "heuristic", estimated: true }
    );
  });

  it("clearSession 只清目标会话桶；stats 反映桶数与条数", () => {
    promptWholeCache.record(SESSION_ID, SCOPE, contentKey(1), ENTRY);
    promptWholeCache.record("sess-b", SCOPE, contentKey(1), ENTRY);
    assert.deepEqual(promptWholeCache.stats(), { sessions: 2, entries: 2 });

    promptWholeCache.clearSession(SESSION_ID);
    assert.equal(
      promptWholeCache.lookup(SESSION_ID, SCOPE, contentKey(1)),
      undefined
    );
    assert.deepEqual(promptWholeCache.stats(), { sessions: 1, entries: 1 });
  });

  it("KKV 持久化往返：精确档 record → persist 落库 → 清内存（模拟重启）→ seed 后 lookup(\"\",…) 命中", async () => {
    const kkv = createFakeKkv();
    const hash = hex16(1);
    promptWholeCache.record("", SCOPE, hash, {
      tokenCount: 4242,
      counterKind: "glm",
      estimated: false,
    });
    promptWholeCache.persistPendingWrites(kkv, SESSION_ID);
    assert.equal(kkv.setCalls, 1, "首轮有条目 → 写一次库");

    // 模拟进程重启：内存层清空，只剩 KKV 里的持久化表。
    promptWholeCache.clearForTests();
    assert.equal(promptWholeCache.lookup("", SCOPE, hash), undefined);

    const seeded = await promptWholeCache.seedFromKkv(kkv, SESSION_ID);
    assert.equal(seeded, 1);
    assert.deepEqual(promptWholeCache.lookup("", SCOPE, hash), {
      tokenCount: 4242,
      counterKind: "glm",
      estimated: false,
    });
  });

  it("heuristic 档（estimated:true）不收集、不落库", async () => {
    const kkv = createFakeKkv();
    promptWholeCache.record("", SCOPE, hex16(2), ENTRY); // estimated: true
    promptWholeCache.persistPendingWrites(kkv, SESSION_ID);
    assert.equal(kkv.setCalls, 0, "无精确档条目 → 不写库");
    assert.equal(await promptWholeCache.seedFromKkv(kkv, SESSION_ID), 0);
  });

  it("无变化不写库：同键重复 record 后 persist 只在首轮回写", async () => {
    const kkv = createFakeKkv();
    const hash = hex16(3);
    for (let i = 0; i < 3; i += 1) {
      promptWholeCache.record("", SCOPE, hash, {
        tokenCount: 7,
        counterKind: "tiktoken",
        estimated: false,
      });
      promptWholeCache.persistPendingWrites(kkv, SESSION_ID);
    }
    assert.equal(kkv.setCalls, 1, "去重合并后 payload 不变 → 后续轮不写库");
    // 落库条目仍是 1 条（同 hash+scope 去重）。
    promptWholeCache.clearForTests();
    assert.equal(await promptWholeCache.seedFromKkv(kkv, SESSION_ID), 1);
  });

  it("坏 payload（版本不符 / 非法条目 / est=true 行）静默按无种子处理", async () => {
    const kkv = createFakeKkv();
    await kkv.set("s", "token_chunks", "promptWholeCache", "not-json");
    assert.equal(await promptWholeCache.seedFromKkv(kkv, "s"), 0);

    await kkv.set(
      "s2",
      "token_chunks",
      "promptWholeCache",
      JSON.stringify({ v: 999, items: [] })
    );
    assert.equal(await promptWholeCache.seedFromKkv(kkv, "s2"), 0);

    // est 非 false 的行整体拒绝（写入侧只收精确档，读到旧形态视为脏数据）。
    await kkv.set(
      "s3",
      "token_chunks",
      "promptWholeCache",
      JSON.stringify({
        v: 1,
        items: [["0123456789abcdef", SCOPE, 10, "glm", true]],
      })
    );
    assert.equal(await promptWholeCache.seedFromKkv(kkv, "s3"), 0);
    assert.equal(promptWholeCache.lookup("", SCOPE, "0123456789abcdef"), undefined);
  });
});
