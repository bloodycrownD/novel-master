/**
 * 进程内解压产物缓存（统一层）单测：LRU 顺序、双上界逐出、超预算单条
 * 不收录、计数与清空口径。
 *
 * 与三个读链条目的分工：本文件只测池子本身的行为（纯内存，不落库）；
 * 各读链的接线与失效在 vfs / session-kkv / chat 三处的集成用例里测。
 *
 * @module test/infra/content-cache/decoded-content-cache
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DecodedContentPool,
  clearDecodedContentCaches,
  decodedContentCacheStats,
  forgetDecodedMessageContent,
  lookupDecodedContentBody,
  lookupDecodedMessageContent,
  rememberDecodedContentBody,
  rememberDecodedMessageContent,
} from "@/infra/content-cache/logic/decoded-content-cache.js";

describe("DecodedContentPool", () => {
  it("miss → set → hit；命中刷新 LRU 序（最久未用先逐出）", () => {
    const pool = new DecodedContentPool({
      name: "t",
      maxEntries: 3,
      maxChars: 1000,
    });

    assert.equal(pool.get("a"), null, "空池必 miss");
    pool.set("a", "AAA");
    pool.set("b", "BBB");
    pool.set("c", "CCC");
    assert.equal(pool.get("a"), "AAA");

    // a 刚被命中 → 最久未用的是 b，先被逐出
    pool.set("d", "DDD");
    assert.equal(pool.get("b"), null);
    assert.equal(pool.get("a"), "AAA");
    assert.equal(pool.get("c"), "CCC");
    assert.equal(pool.get("d"), "DDD");
  });

  it("字符上界：超限时逐出最旧，char 记账跟着减", () => {
    const pool = new DecodedContentPool({
      name: "t",
      maxEntries: 100,
      maxChars: 10,
    });
    pool.set("a", "12345"); // 5 字符
    pool.set("b", "67890"); // 5 字符 → 共 10，恰好卡线不逐出
    assert.equal(pool.stats().chars, 10);
    assert.equal(pool.get("b"), "67890"); // 序仍是 [a, b]
    assert.equal(pool.get("a"), "12345"); // 刷新 a → 序变 [b, a]

    pool.set("c", "XYZ"); // 13 > 10 → 逐出最旧的 b
    assert.equal(pool.get("b"), null);
    assert.equal(pool.get("a"), "12345");
    assert.equal(pool.stats().chars, 8);
    assert.equal(pool.stats().evictions, 1);
  });

  it("单条超过整池预算：不收录，且不逐出既有条目", () => {
    const pool = new DecodedContentPool({
      name: "t",
      maxEntries: 10,
      maxChars: 10,
    });
    pool.set("a", "12345");
    pool.set("huge", "x".repeat(11)); // 超预算 → 直接不收录

    assert.equal(pool.get("huge"), null);
    assert.equal(pool.get("a"), "12345", "既有条目不被牵连逐出");
    assert.equal(pool.stats().evictions, 0);
  });

  it("超预算值覆盖同键旧值：旧值被清掉（宁可 miss，不留陈旧值）", () => {
    const pool = new DecodedContentPool({
      name: "t",
      maxEntries: 10,
      maxChars: 10,
    });
    pool.set("k", "12345");
    assert.equal(pool.get("k"), "12345");

    // 同键写入超预算值：该键的旧值必须消失——消息池里「同键换了值」只可能
    // 是 forget 漏了，此时留着旧值就是返回陈旧正文（宁可退化成一次 miss）。
    pool.set("k", "x".repeat(11));
    assert.equal(pool.get("k"), null);
    assert.equal(pool.stats().chars, 0, "旧值的 char 记账一并减掉");
  });

  it("同键覆盖写：char 记账按新值重算（不重复累加）", () => {
    const pool = new DecodedContentPool({
      name: "t",
      maxEntries: 10,
      maxChars: 100,
    });
    pool.set("a", "12345");
    pool.set("a", "1234567890");
    assert.equal(pool.stats().entries, 1);
    assert.equal(pool.stats().chars, 10);
  });

  it("delete / clear / stats：条目与计数口径", () => {
    const pool = new DecodedContentPool({
      name: "t",
      maxEntries: 10,
      maxChars: 100,
    });
    pool.set("a", "AAA");
    assert.equal(pool.get("a"), "AAA");
    assert.equal(pool.get("miss"), null);
    let stats = pool.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);

    pool.delete("a");
    assert.equal(pool.get("a"), null);

    pool.set("b", "BBB");
    pool.clear();
    stats = pool.stats();
    assert.equal(stats.entries, 0);
    assert.equal(stats.chars, 0);
    assert.equal(stats.hits, 0, "clear 把计数一并归零（用例隔离用）");
    assert.equal(stats.misses, 0);
  });
});

describe("统一层单例池", () => {
  it("内容正文池与消息正文池互不串键；forget 只作用于消息池", () => {
    clearDecodedContentCaches();
    rememberDecodedContentBody("hash-1", "文件正文");
    rememberDecodedMessageContent("msg-1", '{"blocks":[]}');

    assert.equal(lookupDecodedContentBody("hash-1"), "文件正文");
    assert.equal(lookupDecodedMessageContent("msg-1"), '{"blocks":[]}');

    forgetDecodedMessageContent("msg-1");
    assert.equal(lookupDecodedMessageContent("msg-1"), null);
    assert.equal(
      lookupDecodedContentBody("hash-1"),
      "文件正文",
      "forget 消息不影响内容池"
    );

    // 同名字符串在两个池里各自独立（键空间不共享）
    rememberDecodedContentBody("shared-key", "内容池的值");
    rememberDecodedMessageContent("shared-key", "消息池的值");
    assert.equal(lookupDecodedContentBody("shared-key"), "内容池的值");
    assert.equal(lookupDecodedMessageContent("shared-key"), "消息池的值");

    clearDecodedContentCaches();
    assert.equal(lookupDecodedContentBody("hash-1"), null);
    assert.equal(lookupDecodedMessageContent("shared-key"), null);
  });

  it("空串是合法值：存取往返仍是「命中」而不是 miss", () => {
    clearDecodedContentCaches();
    rememberDecodedContentBody("empty", "");
    assert.equal(lookupDecodedContentBody("empty"), "", "空文件正文要能缓存");

    const stats = decodedContentCacheStats();
    const contentStats = stats.find((s) => s.name === "content-body");
    assert.ok(contentStats != null);
    assert.equal(contentStats.hits, 1);
    clearDecodedContentCaches();
    const cleared = decodedContentCacheStats().find(
      (s) => s.name === "content-body"
    );
    assert.equal(cleared!.hits, 0);
    assert.equal(cleared!.entries, 0);
  });
});
