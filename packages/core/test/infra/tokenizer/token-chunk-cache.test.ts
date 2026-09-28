/**
 * T-TC2 / T-TC3：L2 块 token 平面缓存（token-chunk-cache）单测。
 *
 * T-TC2 行为：append 仅新块 miss；编辑改一字仅变化邻域 miss（实测模式
 * 2 块）；压缩（移除前缀）后剩余块 100% 命中；换计数器身份全 miss；三代
 * 内回滚命中 / 第四代淘汰；命中提升至当前代；总量上限（小上限注入版）。
 *
 * T-TC3 持久化：advanceGeneration+realRefresh 写 KKV；清热层后 seedFromKkv
 * 载入命中（不顶当前代）；坏 JSON / 版本不符 / 字段非法静默 miss 不抛；
 * KKV 写/读失败只 warn 不抛。
 *
 * 计数断言口径：一律用「缓存命中 → 不再触碰 encode」——miss 时才调用假
 * encode（字符数当 token 数），不假设单块对应恰好 1 次 encode。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
  TOKEN_CHUNKS_CACHE_KEY,
} from "../../../src/domain/session-kkv/model/session-kkv-domains.js";
import { splitTextIntoChunks } from "../../../src/infra/tokenizer/logic/chunk-splitter.js";
import {
  chunkHash16,
  parseTokenChunkCachePayload,
  tokenChunkCache,
} from "../../../src/infra/tokenizer/logic/token-chunk-cache.js";
import { createMemorySessionKkv } from "../../helpers/prompt-layout-test-helpers.js";

const SESSION_ID = "sess-tc2";
const SCOPE = "vendor/m:tk:auto:node";
const ALT_SCOPE = "vendor/m2:tk:glm:rn";

/**
 * 模拟一轮完整计数周期：split → 逐块 lookup，miss 才「现算」（假 encode：
 * 块字符数当 token 数）并 record。返回本轮 miss 的块列表（= 触发 encode
 * 的块，缓存行为断言的口径）。
 */
function countRound(text: string, scope: string): string[] {
  const missed: string[] = [];
  for (const chunk of splitTextIntoChunks(text)) {
    const h = chunkHash16(chunk);
    if (tokenChunkCache.lookup(h, scope) === undefined) {
      missed.push(chunk);
      tokenChunkCache.record(h, scope, chunk.length);
    }
  }
  return missed;
}

/** 等待 fire-and-forget 的 KKV 写落地（两层微任务，同 store 测试口径）。 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/** 捕获 console.warn（写/读失败路径各告警一次），返回还原函数。 */
function captureWarnings(): { restore(): void } {
  const original = console.warn;
  console.warn = (): void => undefined;
  return {
    restore(): void {
      console.warn = original;
    },
  };
}

describe("token-chunk-cache 行为（T-TC2）", () => {
  beforeEach(() => {
    tokenChunkCache.clearForTests();
  });

  it("append：已有块集合后新增消息，仅新块 miss（旧块全命中不再 encode）", () => {
    const base = "第一段正文内容。第二段正文内容。第三段正文内容。";
    const firstRound = countRound(base, SCOPE);
    assert.equal(firstRound.length, splitTextIntoChunks(base).length, "首轮全 miss");

    tokenChunkCache.advanceGeneration(SESSION_ID);

    const appended = `${base}第四段新增消息正文。`;
    const secondRound = countRound(appended, SCOPE);
    // 仅新块 miss；旧块（在第二代）命中并被提升回当前代
    assert.deepEqual(secondRound, ["第四段新增消息正文。"]);
  });

  it("编辑：句中改一字仅所在块 miss（自然编辑局部性 = 1 块）", () => {
    const text =
      "夜色如水，林间小径上落满了枯叶，风一吹便沙沙作响。她停下脚步，抬头望向远处那片朦胧的灯火。";
    countRound(text, SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID);
    const edited = text.replace("径", "迹");
    const missed = countRound(edited, SCOPE);
    // 改动落在首块内部非边界字符：只有首块变，第二句块原样命中
    assert.equal(missed.length, 1);
    assert.ok(missed[0]!.startsWith("夜色如水"));
  });

  it("编辑：改掉软边界字符仅变化邻域 miss（实测模式 2 块）", () => {
    // 70 字符无句末符号：软边界「、」在位置 30，块切为 [31, 39]；
    // 把「、」改成「乙」（软边界消失）→ 硬切为 [64, 6]，恰好两块全变。
    const textA = `${"甲".repeat(30)}、${"乙".repeat(39)}`;
    const textB = `${"甲".repeat(30)}${"乙".repeat(40)}`;
    assert.deepEqual(
      splitTextIntoChunks(textA).map((c) => c.length),
      [31, 39],
      "夹具前提：软边界切分"
    );
    assert.deepEqual(
      splitTextIntoChunks(textB).map((c) => c.length),
      [64, 6],
      "夹具前提：软边界消失后硬切"
    );

    countRound(textA, SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID);
    const missed = countRound(textB, SCOPE);
    // 一个字符的编辑最多波及变化点邻域的 2 块，绝不触发全量重算
    assert.equal(missed.length, 2);
  });

  it("压缩：移除前缀消息后剩余块 100% 命中（encode 0 次）", () => {
    const prefix = "这是将被压缩掉的前缀消息甲。这是将被压缩掉的前缀消息乙。\n";
    const suffix = "保留下来的正文第一句。保留下来的正文第二句。保留下来的正文第三句。";
    countRound(`${prefix}${suffix}`, SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID);

    const missed = countRound(suffix, SCOPE);
    assert.equal(missed.length, 0, "剩余块全部命中（压缩后无需任何重算）");
    // 且命中值正确（假 encode：块字符数）
    for (const chunk of splitTextIntoChunks(suffix)) {
      assert.equal(
        tokenChunkCache.lookup(chunkHash16(chunk), SCOPE),
        chunk.length
      );
    }
  });

  it("换计数器身份（scope）：同文本全 miss", () => {
    const text = "同一份文本内容。换词表就得重数。";
    countRound(text, SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID);

    const missed = countRound(text, ALT_SCOPE);
    assert.equal(missed.length, splitTextIntoChunks(text).length, "跨 scope 无串味");
  });

  it("三代内回滚：隔一代 / 隔两代回旧块集合仍 100% 命中", () => {
    const setA = "A 第一句。A 第二句。A 第三句。";
    countRound(setA, SCOPE); // A → 当前代
    tokenChunkCache.advanceGeneration(SESSION_ID); // A → 第二代
    countRound("B 第一句。B 第二句。", SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID); // A → 第三代，B → 第二代
    countRound("C 第一句。", SCOPE);

    // 隔两代回 A：A 仍在第三代（三代环形窗口内）
    assert.equal(countRound(setA, SCOPE).length, 0, "三代内回滚全命中");
  });

  it("第四代淘汰：推进三次后旧集合被环形淘汰（全 miss）", () => {
    const setA = "A 一。A 二。A 三。";
    countRound(setA, SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID); // #1：A → 二代
    countRound("B 一。B 二。", SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID); // #2：A → 三代
    countRound("C 一。", SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID); // #3：A 淘汰

    const missed = countRound(setA, SCOPE);
    assert.equal(
      missed.length,
      splitTextIntoChunks(setA).length,
      "第四代起旧块淘汰，自然重算"
    );
  });

  it("命中提升至当前代：被触碰的旧集合多活两代", () => {
    const setA = "A 一。A 二。";
    countRound(setA, SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID);
    countRound("B 一。B 二。", SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID); // A → 第三代

    // 触碰 A（命中并提升回当前代）
    assert.equal(countRound(setA, SCOPE).length, 0);
    const genCountsAfterTouch = tokenChunkCache.stats().genCounts;
    assert.equal(genCountsAfterTouch[2], 0, "第三代被提空");

    // 再推进两代：若提升未生效，A 早已在第四次推进中淘汰
    tokenChunkCache.advanceGeneration(SESSION_ID);
    tokenChunkCache.advanceGeneration(SESSION_ID);
    assert.equal(
      countRound(setA, SCOPE).length,
      0,
      "提升让被再次触碰的集合存活更久"
    );
  });

  it("总量上限：小上限注入版——超限先淘汰最旧代，当前代保留（T-TC2）", () => {
    tokenChunkCache.setMaxTotalEntriesForTests(5);
    countRound("一一。二二。三三。四四。", SCOPE); // 当前代 4 块
    tokenChunkCache.advanceGeneration(SESSION_ID); // → 第二代
    const missed = countRound("五五。六六。七七。八八。", SCOPE); // 新 4 块

    assert.equal(missed.length, 4, "新块照常 miss 后 record");
    assert.ok(
      tokenChunkCache.stats().total <= 5,
      `总量不得超过注入上限，实际 ${tokenChunkCache.stats().total}`
    );
    // 超限淘汰先清最旧代：第一轮的块已不可见
    assert.equal(
      tokenChunkCache.lookup(chunkHash16("一一。"), SCOPE),
      undefined,
      "最旧代已被上限淘汰"
    );
    assert.equal(
      tokenChunkCache.lookup(chunkHash16("五五。"), SCOPE),
      3,
      "当前代条目保留"
    );
  });

  it("单代自身超限：按插入序淘汰当前代最旧条目", () => {
    tokenChunkCache.setMaxTotalEntriesForTests(2);
    countRound("一。二。三。", SCOPE); // 3 块 > 2：最早插入的「一。」被裁
    assert.ok(tokenChunkCache.stats().total <= 2);
    assert.equal(tokenChunkCache.lookup(chunkHash16("一。"), SCOPE), undefined);
    assert.equal(tokenChunkCache.lookup(chunkHash16("三。"), SCOPE), 2);
  });
});

describe("token-chunk-cache KKV 持久化（T-TC3）", () => {
  beforeEach(() => {
    tokenChunkCache.clearForTests();
  });

  it("advanceGeneration + realRefresh：推进前当前代整表写入 KKV（紧凑 JSON）", async () => {
    const kkv = createMemorySessionKkv();
    countRound("甲句正文。乙句正文。", SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();

    const raw = await kkv.get(
      SESSION_ID,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY
    );
    assert.ok(raw != null, "token_chunks/chunkCache 行已落库");
    const parsed = JSON.parse(raw) as { v: number; items: unknown[][] };
    assert.equal(parsed.v, 1);
    // 只写推进前的当前代（record 顺序），三元组 [hash16, scope, count]
    assert.deepEqual(parsed.items, [
      [chunkHash16("甲句正文。"), SCOPE, 5],
      [chunkHash16("乙句正文。"), SCOPE, 5],
    ]);
  });

  it("非真实刷新（realRefresh 缺省 / false）与未装配 sessionKkv 均不写、不抛", async () => {
    const kkv = createMemorySessionKkv();
    countRound("内容一。内容二。", SCOPE); // 当前代 2 块
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
    }); // realRefresh 缺省：只推进不落库
    assert.equal(
      await kkv.get(
        SESSION_ID,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        TOKEN_CHUNKS_CACHE_KEY
      ),
      null,
      "realRefresh 缺省（预热）不落库"
    );
    // 代际照常推进：当前代清空、内容块进第二代
    assert.deepEqual(tokenChunkCache.stats().genCounts, [0, 2, 0]);

    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: false,
    });
    tokenChunkCache.advanceGeneration(SESSION_ID); // 未装配持久化通道
    await flushMicrotasks();
    assert.equal(
      await kkv.get(
        SESSION_ID,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        TOKEN_CHUNKS_CACHE_KEY
      ),
      null,
      "false / 未装配不落库"
    );
  });

  it("清热层后 seedFromKkv 载入为最旧代种子（不顶当前代），lookup 命中", async () => {
    const kkv = createMemorySessionKkv();
    countRound("甲句正文。乙句正文。", SCOPE);
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();

    tokenChunkCache.clearForTests(); // 模拟进程重启：热层全清
    const seeded = await tokenChunkCache.seedFromKkv(kkv, SESSION_ID);
    assert.equal(seeded, 2);
    // 种子作最旧可用代：当前代仍为空
    assert.deepEqual(tokenChunkCache.stats().genCounts, [0, 0, 2]);
    assert.equal(
      tokenChunkCache.lookup(chunkHash16("甲句正文。"), SCOPE),
      5,
      "种子条目可命中"
    );

    // 当前代已有新鲜条目时，种子同样只进最旧代
    tokenChunkCache.clearForTests();
    await kkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY,
      JSON.stringify({
        v: 1,
        items: [[chunkHash16("种子句。"), SCOPE, 4]],
      })
    );
    countRound("当前代新鲜块。", SCOPE);
    assert.equal(await tokenChunkCache.seedFromKkv(kkv, SESSION_ID), 1);
    assert.deepEqual(
      tokenChunkCache.stats().genCounts,
      [1, 0, 1],
      "种子不顶当前代"
    );
  });

  it("坏 JSON / 版本不符 / 字段非法：静默忽略返回 0，不抛错", async () => {
    const kkv = createMemorySessionKkv();
    const badPayloads = [
      "{broken",
      JSON.stringify({ v: 2, items: [] }), // 版本号不符
      JSON.stringify({ v: 1 }), // 缺 items
      JSON.stringify({ v: 1, items: {} }), // items 非数组
      JSON.stringify({ v: 1, items: [["zz", SCOPE, 3]] }), // hash 非 16 hex
      JSON.stringify({
        v: 1,
        items: [["a".repeat(15), SCOPE, 3]], // hash 长度不足
      }),
      JSON.stringify({ v: 1, items: [["a".repeat(16), "", 3]] }), // scope 空
      JSON.stringify({ v: 1, items: [["a".repeat(16), SCOPE, -1]] }), // count 负
      JSON.stringify({
        v: 1,
        items: [["a".repeat(16), SCOPE, "3"]], // count 非数
      }),
      JSON.stringify({
        v: 1,
        items: [["a".repeat(16), SCOPE]], // 条目缺字段
      }),
    ];
    for (const payload of badPayloads) {
      await kkv.set(
        SESSION_ID,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        TOKEN_CHUNKS_CACHE_KEY,
        payload
      );
      assert.equal(
        await tokenChunkCache.seedFromKkv(kkv, SESSION_ID),
        0,
        `坏载荷应静默忽略：${payload.slice(0, 48)}`
      );
      assert.equal(tokenChunkCache.stats().total, 0, "坏载荷不得载入任何条目");
    }
    // 坏载荷后续 lookup 按 miss 处理（不抛、不造数）
    assert.equal(tokenChunkCache.lookup(chunkHash16("任意块。"), SCOPE), undefined);
  });

  it("parse 防御（纯函数）：合法载荷往返、未知键忽略、null 容错", () => {
    assert.equal(parseTokenChunkCachePayload(null), null);
    assert.equal(parseTokenChunkCachePayload(""), null);
    const items = parseTokenChunkCachePayload(
      JSON.stringify({
        v: 1,
        items: [[chunkHash16("块一。"), SCOPE, 3]],
        someFutureKey: true, // 未知键忽略（未来加字段不破老解析）
      })
    );
    assert.deepEqual(items, [[chunkHash16("块一。"), SCOPE, 3]]);
  });

  it("KKV 写失败只 warn 不抛，代际照常推进", async () => {
    const warnings = captureWarnings();
    try {
      const badKkv = {
        ...createMemorySessionKkv(),
        async set(): Promise<void> {
          throw new Error("disk full");
        },
      };
      countRound("正文一。正文二。", SCOPE);
      tokenChunkCache.advanceGeneration(SESSION_ID, {
        persist: { sessionKkv: badKkv },
        realRefresh: true,
      });
      await flushMicrotasks(); // unhandled rejection 不冒出
      // 推进本身成功：块已进第二代
      assert.deepEqual(tokenChunkCache.stats().genCounts, [0, 2, 0]);
    } finally {
      warnings.restore();
    }
  });

  it("KKV 读失败按无种子处理（warn + 返回 0），不抛", async () => {
    const warnings = captureWarnings();
    try {
      const badKkv = {
        ...createMemorySessionKkv(),
        async get(): Promise<string | null> {
          throw new Error("db down");
        },
      };
      assert.equal(await tokenChunkCache.seedFromKkv(badKkv, SESSION_ID), 0);
    } finally {
      warnings.restore();
    }
  });

  it("sessionKkv 缺省：seedFromKkv 返回 0（未装配退化，不报错）", async () => {
    assert.equal(await tokenChunkCache.seedFromKkv(undefined, SESSION_ID), 0);
    assert.equal(await tokenChunkCache.seedFromKkv(null, SESSION_ID), 0);
  });
});
