/**
 * L1 整串缓存（prompt-whole-cache）单测。
 *
 * 覆盖：命中返回；内容指纹 / 计数器身份变化即 miss；会话级 LRU 32 条
 * （最旧淘汰、命中提升新鲜度）；clearSession；stats / clearForTests。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
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
});
