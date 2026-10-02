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
    assert.equal(parsed.v, 2);
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
        v: 2,
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
      JSON.stringify({ v: 3, items: [] }), // 版本号不符（v2 为当前，v3 表未来版本）
      JSON.stringify({ v: 2 }), // 缺 items
      JSON.stringify({ v: 2, items: {} }), // items 非数组
      JSON.stringify({ v: 2, items: [["zz", SCOPE, 3]] }), // hash 非 16 hex
      JSON.stringify({
        v: 2,
        items: [["a".repeat(15), SCOPE, 3]], // hash 长度不足
      }),
      JSON.stringify({ v: 2, items: [["a".repeat(16), "", 3]] }), // scope 空
      JSON.stringify({ v: 2, items: [["a".repeat(16), SCOPE, -1]] }), // count 负
      JSON.stringify({
        v: 2,
        items: [["a".repeat(16), SCOPE, "3"]], // count 非数
      }),
      JSON.stringify({
        v: 2,
        items: [["a".repeat(16), SCOPE]], // 条目缺字段
      }),
      JSON.stringify({
        v: 1,
        items: [["a".repeat(16), SCOPE, 3]], // v1 = sha256 键域旧行（token-count-perf-r2 前），整体丢弃
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
        v: 2,
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

/**
 * 2026-09-30 真机 12.5s 病根的回归护栏：整表 KKV 链（读=整表 select + parse +
 * 全量 Map 重建；写=整表序列化 + 覆盖写）在历史消息多的会话上是一条 MB 级
 * 的链，而读口**每一轮本地计数都重走一遍**。两条止血各有牙齿的断言：
 * seed-once（第二轮不再发 KKV 读）与脏标记跳过持久化（无新记录的轮次根本
 * 不发 KKV 写）。观测口径一律数 KKV 的 get/set 实际调用次数。
 */
describe("token-chunk-cache 整表链节流（2026-09-30 12.5s 止血）", () => {
  beforeEach(() => {
    tokenChunkCache.clearForTests();
  });

  /** 数 `token_chunks/chunkCache` 这一行的实际 get / set 次数（其余键不计入）。 */
  function instrumentChunkRowKkv(): {
    kkv: ReturnType<typeof createMemorySessionKkv>;
    gets: () => number;
    sets: () => number;
  } {
    const base = createMemorySessionKkv();
    let gets = 0;
    let sets = 0;
    const isChunkRow = (domain: string, key: string): boolean =>
      domain === SESSION_KKV_DOMAIN_TOKEN_CHUNKS && key === TOKEN_CHUNKS_CACHE_KEY;
    const kkv = {
      ...base,
      async get(sessionId: string, domain: string, key: string) {
        if (isChunkRow(domain, key)) gets += 1;
        return base.get(sessionId, domain, key);
      },
      async set(
        sessionId: string,
        domain: string,
        key: string,
        value: string
      ): Promise<void> {
        if (isChunkRow(domain, key)) sets += 1;
        await base.set(sessionId, domain, key, value);
      },
    };
    return { kkv, gets: () => gets, sets: () => sets };
  }

  /** 预置一条可解析的种子载荷（不经 record，直接写库模拟上次落盘）。 */
  async function seedRow(
    kkv: ReturnType<typeof createMemorySessionKkv>,
    sessionId: string,
    items: [string, string, number][]
  ): Promise<void> {
    await kkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY,
      JSON.stringify({ v: 2, items })
    );
  }

  it("seed-once：同会话连续两次 seedFromKkv 只发一次 KKV 读（第二次连读都不发）", async () => {
    const { kkv, gets } = instrumentChunkRowKkv();
    await seedRow(kkv, SESSION_ID, [[chunkHash16("种子块。"), SCOPE, 7]]);

    assert.equal(await tokenChunkCache.seedFromKkv(kkv, SESSION_ID), 1, "首轮载入种子");
    assert.equal(gets(), 1, "首轮应发一次 KKV 读");

    assert.equal(
      await tokenChunkCache.seedFromKkv(kkv, SESSION_ID),
      0,
      "已 seed 的会话重复 seed 直接返回 0"
    );
    assert.equal(gets(), 1, "第二轮不得再读 KKV（整表 JSON.parse + Map 重建是纯浪费）");
    assert.equal(
      tokenChunkCache.lookup(chunkHash16("种子块。"), SCOPE),
      7,
      "首次载入的种子条目仍在（重复 seed 没有副作用）"
    );
  });

  it("seed-once 按会话隔离：另一个会话仍各自 seed 一次", async () => {
    const { kkv, gets } = instrumentChunkRowKkv();
    await seedRow(kkv, SESSION_ID, [[chunkHash16("甲块。"), SCOPE, 3]]);
    await seedRow(kkv, "sess-other", [[chunkHash16("乙块。"), SCOPE, 4]]);

    assert.equal(await tokenChunkCache.seedFromKkv(kkv, SESSION_ID), 1);
    assert.equal(await tokenChunkCache.seedFromKkv(kkv, "sess-other"), 1);
    assert.equal(gets(), 2, "两个会话各读一次");
    assert.equal(await tokenChunkCache.seedFromKkv(kkv, "sess-other"), 0);
    assert.equal(gets(), 2, "已 seed 的会话不再重复读");
    assert.equal(tokenChunkCache.lookup(chunkHash16("甲块。"), SCOPE), 3);
    assert.equal(tokenChunkCache.lookup(chunkHash16("乙块。"), SCOPE), 4);
  });

  it("clearForTests 复位 seed-once：模拟进程重启后可重新 seed", async () => {
    const { kkv, gets } = instrumentChunkRowKkv();
    await seedRow(kkv, SESSION_ID, [[chunkHash16("重启块。"), SCOPE, 6]]);
    assert.equal(await tokenChunkCache.seedFromKkv(kkv, SESSION_ID), 1);

    tokenChunkCache.clearForTests(); // 模拟进程重启
    assert.equal(await tokenChunkCache.seedFromKkv(kkv, SESSION_ID), 1, "重启后重新 seed");
    assert.equal(gets(), 2);
    assert.equal(tokenChunkCache.lookup(chunkHash16("重启块。"), SCOPE), 6);
  });

  it("脏标记：有新 record 的轮次照常落库，随后无新记录的轮次跳过整表写", async () => {
    const { kkv, sets } = instrumentChunkRowKkv();

    // 轮次 1：有新块 → 脏 → 整表落库
    assert.ok(countRound("甲句正文。乙句正文。", SCOPE).length > 0);
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();
    assert.equal(sets(), 1, "有新记录的轮次必须落库");
    const first = await kkv.get(
      SESSION_ID,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY
    );
    assert.ok(first != null);

    // 轮次 2：全部命中、零 record → 干净 → 跳过序列化与写入
    assert.equal(countRound("甲句正文。乙句正文。", SCOPE).length, 0, "夹具前提：本轮零 record");
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();
    assert.equal(sets(), 1, "无新记录的轮次不得重复整表落库");
    assert.equal(
      await kkv.get(
        SESSION_ID,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        TOKEN_CHUNKS_CACHE_KEY
      ),
      first,
      "跳过的轮次库里内容原样不动"
    );
    // 代际轮换照旧执行（内存语义不变）
    assert.deepEqual(tokenChunkCache.stats().genCounts, [0, 2, 0]);

    // 轮次 3：又有新块 → 重新落库
    assert.ok(countRound("丙句正文。", SCOPE).length > 0);
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();
    assert.equal(sets(), 2, "脏标记复位后有记录的轮次重新落库");
    assert.notEqual(
      await kkv.get(
        SESSION_ID,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        TOKEN_CHUNKS_CACHE_KEY
      ),
      first,
      "新一轮的整表内容确实变了"
    );
  });

  it("脏标记在安排写入后清：随后只有「提升」（零 record）的轮次不再整表写", async () => {
    const { kkv, sets } = instrumentChunkRowKkv();
    const chunk = "甲句正文。";

    assert.ok(countRound(chunk, SCOPE).length > 0, "夹具前提：本轮有新块 → 脏");
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();
    assert.equal(sets(), 1, "脏轮次落库一次");

    // 触碰同一块（命中并提升回当前代，零 record）后推进：内容没变，不该再写
    assert.ok(
      tokenChunkCache.lookup(chunkHash16(chunk), SCOPE) !== undefined,
      "夹具前提：块可命中（提升路径）"
    );
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();
    assert.equal(sets(), 1, "写入安排过之后，零 record 的轮次不得重复整表写");
  });

  it("未装配持久化通道的轮次不清脏：下一轮真实刷新照常落库", async () => {
    const { kkv, sets } = instrumentChunkRowKkv();
    const chunk = "甲句正文。";

    countRound(chunk, SCOPE); // 脏 → 但本轮没装配持久化通道
    tokenChunkCache.advanceGeneration(SESSION_ID);
    assert.equal(sets(), 0, "未装配持久化通道不落库");

    // 触碰提升（零 record）后走一条真实刷新轮次：脏标记仍在 → 照常落库
    assert.ok(tokenChunkCache.lookup(chunkHash16(chunk), SCOPE) !== undefined);
    tokenChunkCache.advanceGeneration(SESSION_ID, {
      persist: { sessionKkv: kkv },
      realRefresh: true,
    });
    await flushMicrotasks();
    assert.equal(sets(), 1, "跳过持久化的轮次不能顺手把脏标记清了");
    const raw = await kkv.get(
      SESSION_ID,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY
    );
    assert.deepEqual(JSON.parse(raw as string).items, [
      [chunkHash16(chunk), SCOPE, chunk.length],
    ]);
  });

  /**
   * r3-l2-1：seed-once 的登记**只在读成功时才有资格留下**。读抛错 / 坏行
   * 两个失败分支必须撤销登记，否则一次瞬时读错（库忙、连接瞬断、并发写坏
   * 行）就把整个进程内该会话的跨重启续命锁死——既永远拿不到种子，又每轮
   * 白付一次整表读。
   */
  it("seed 读抛错会撤销登记：第二轮仍发 KKV 读（gets===2）并能正常载入种子", async () => {
    const base = createMemorySessionKkv();
    await seedRow(base, SESSION_ID, [[chunkHash16("重试种子块。"), SCOPE, 9]]);
    let gets = 0;
    let failNext = true;
    const flakyKkv = {
      ...base,
      async get(sessionId: string, domain: string, key: string) {
        if (domain === SESSION_KKV_DOMAIN_TOKEN_CHUNKS && key === TOKEN_CHUNKS_CACHE_KEY) {
          gets += 1;
          if (failNext) {
            failNext = false;
            throw new Error("db busy");
          }
        }
        return base.get(sessionId, domain, key);
      },
    };

    const warnings = captureWarnings();
    let seeded: number;
    try {
      seeded = await tokenChunkCache.seedFromKkv(flakyKkv, SESSION_ID);
    } finally {
      warnings.restore();
    }
    assert.equal(seeded, 0, "首轮读抛错：按无种子处理");
    assert.equal(gets, 1, "首轮发了 KKV 读");
    assert.equal(
      tokenChunkCache.lookup(chunkHash16("重试种子块。"), SCOPE),
      undefined,
      "读失败不得造数"
    );

    // 第二轮：登记必须已被撤销 → 真的再发一次读，并成功载入种子
    assert.equal(
      await tokenChunkCache.seedFromKkv(flakyKkv, SESSION_ID),
      1,
      "读失败后第二轮应重试并载入种子"
    );
    assert.equal(gets, 2, "读失败不得把会话永久登记成已 seed（r3-l2-1）");
    assert.equal(tokenChunkCache.lookup(chunkHash16("重试种子块。"), SCOPE), 9);

    // 第三轮：读成功了才轮到节流生效
    assert.equal(await tokenChunkCache.seedFromKkv(flakyKkv, SESSION_ID), 0);
    assert.equal(gets, 2, "成功读过一次后才节流");
  });

  it("seed 读到坏行同样撤销登记：下一轮读到正常行仍能载入（gets===2）", async () => {
    const base = createMemorySessionKkv();
    // 库里的行本身是好的（模拟「瞬时被写坏、随后被写侧修好」）：只有读到的
    // 那一次返回坏载荷，底层存储不被本次用例改动。
    await seedRow(base, SESSION_ID, [[chunkHash16("修好后块。"), SCOPE, 8]]);
    let gets = 0;
    let badNext = true;
    const flakyKkv = {
      ...base,
      async get(sessionId: string, domain: string, key: string) {
        if (domain === SESSION_KKV_DOMAIN_TOKEN_CHUNKS && key === TOKEN_CHUNKS_CACHE_KEY) {
          gets += 1;
          if (badNext) {
            badNext = false;
            return "{broken";
          }
        }
        return base.get(sessionId, domain, key);
      },
    };

    assert.equal(
      await tokenChunkCache.seedFromKkv(flakyKkv, SESSION_ID),
      0,
      "首轮坏行：静默按无种子处理"
    );
    assert.equal(gets, 1);
    assert.equal(tokenChunkCache.stats().total, 0, "坏行不得载入任何条目");

    assert.equal(
      await tokenChunkCache.seedFromKkv(flakyKkv, SESSION_ID),
      1,
      "坏行后下一轮应重试"
    );
    assert.equal(gets, 2, "坏行不得把会话永久登记成已 seed（r3-l2-1）");
    assert.equal(tokenChunkCache.lookup(chunkHash16("修好后块。"), SCOPE), 8);
  });
});

/**
 * T-H1~T-H4（token-count-perf-r2）：轻量块哈希（双 32 位 FNV-1a 拼 16 hex）
 * 的正确性 / 分布 / 旧格式兼容护栏。背景：真机 Hermes 无 JIT 下 sha256 每块
 * 固定开销把「L2 全命中轮」推到 4s（计数工作量为零），换 FNV 后该轮应进
 * 亚百 ms——真机 A/B 由 spec Step 3（manual_user）把关，这里的单测锁算法
 * 行为不被无声改坏。
 */
describe("T-H: chunkHash16 轻量哈希（token-count-perf-r2）", () => {
  beforeEach(() => {
    tokenChunkCache.clearForTests();
  });

  it("T-H1 golden：固定输入钉死输出，锁 FNV 常量/遍历序/拼接序", () => {
    // 期望值由实现首版生成（2026-10-03）；改动任何一个常量或遍历方向都会红，
    // 那是刻意的——键域变化必须连带 bump KKV payload 版本（见 spec 决策表）。
    const golden: ReadonlyArray<readonly [string, string]> = [
      ["", "811c9dc59dc5811c"],
      ["a", "e40c292cdaead7c7"],
      ["hello world", "d58b3fa7e0ba3b68"],
      ["你好世界，这是一段中文测试文本。", "3d37b94e428ecd29"],
      ["第一块和第一块", "78f0436348b78928"],
      ["第一块和第二块", "487adc678d903214"],
      ["emoji 🎉 mixed 中英 123", "0f076be72cbe9204"],
    ];
    for (const [input, expected] of golden) {
      const actual = chunkHash16(input);
      assert.match(actual, /^[0-9a-f]{16}$/, "输出形态恒 16 位小写 hex（public 契约）");
      assert.equal(actual, expected, `输入 ${JSON.stringify(input)} 的哈希被改变`);
    }
    // 尾部差异必须传播到前向遍历（h1）——防两遍退化成同向同参数。
    assert.notEqual(chunkHash16("块A。") , chunkHash16("块B。"));
    assert.notEqual(chunkHash16("同一前缀很长很长很长很长很长很长X"), chunkHash16("同一前缀很长很长很长很长很长很长Y"));
  });

  it("T-H2 分布与碰撞：10 万条 CJK 伪随机短串零坍缩（Set 尺寸=条数）", () => {
    // 确定性 LCG——测试可复现；64bit 键域在 100K 量级下理论碰撞概率 ~2.7e-9，
    // 出碰撞即实现缺陷（如两遍相关性退化），不是统计噪声。
    let state = 123456789;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const seen = new Set<string>();
    const total = 100_000;
    for (let i = 0; i < total; i++) {
      const len = 3 + (next() % 48);
      let text = "";
      for (let j = 0; j < len; j++) {
        text += String.fromCharCode(0x4e00 + (next() % 20000));
      }
      seen.add(chunkHash16(text));
    }
    assert.equal(seen.size, total, "10 万短串哈希不得坍缩（出现碰撞即分布缺陷）");
  });

  it("T-H3 旧格式 KKV 行（v1 sha256 键域）静默丢弃不崩", async () => {
    const kkv = createMemorySessionKkv();
    // v1 行：形状合法（16 hex、字段齐），但属于旧 sha256 键域——版本不符整体按
    // miss 丢弃；升级设备上的真实旧行即此形态（键值由旧 sha256 生成，这里用
    // 任意 16 hex 占位，键域不同天然永不命中）。
    await kkv.set(
      SESSION_ID,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY,
      JSON.stringify({
        v: 1,
        items: [["0123456789abcdef", SCOPE, 3]],
      })
    );
    assert.equal(await tokenChunkCache.seedFromKkv(kkv, SESSION_ID), 0, "v1 行按版本不符丢弃");
    assert.equal(tokenChunkCache.stats().total, 0, "不得载入任何旧键域条目");
    // 同键在新哈希域下的正常读写不受影响
    const h = chunkHash16("新域块。");
    tokenChunkCache.record(h, SCOPE, 5);
    assert.equal(tokenChunkCache.lookup(h, SCOPE), 5);
  });

  it("T-H4 确定性与幂等：同输入恒同值，进程内重复调用无状态", () => {
    const a = chunkHash16("重复输入。重复输入。");
    const b = chunkHash16("重复输入。重复输入。");
    assert.equal(a, b, "纯函数确定性");
    // 大输入冒烟（整串 L1 键用同一函数，百 KB 级必须能跑且形态不变）
    const big = "长文本。".repeat(20_000); // 100K 字符
    assert.match(chunkHash16(big), /^[0-9a-f]{16}$/, "大输入输出形态不变");
  });
});
