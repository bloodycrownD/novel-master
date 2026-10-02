/**
 * L1 整串缓存（prompt-whole-cache）单测。
 *
 * 覆盖：命中返回；内容指纹 / 计数器身份变化即 miss；会话级 LRU 32 条
 * （最旧淘汰、命中提升新鲜度）；clearSession；stats / clearForTests；
 * KKV 持久化（record 收集 → persistPendingWrites 落库 → 重启 seedFromKkv
 * 续命；只收精确档；无变化不写库）；L1 种子节流（r3-cache-2：每会话每进程
 * 只真读一次 L1 行、按 key 与 L2 分别计数、读失败/坏行撤销登记下轮重试）。
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SessionKkvService } from "../../../src/service/session-kkv/session-kkv.port.js";
import {
  PROMPT_WHOLE_CACHE_KEY,
  SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
  TOKEN_CHUNKS_CACHE_KEY,
} from "../../../src/domain/session-kkv/model/session-kkv-domains.js";
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
        v: 2,
        items: [["0123456789abcdef", SCOPE, 10, "glm", true]],
      })
    );
    assert.equal(await promptWholeCache.seedFromKkv(kkv, "s3"), 0);
    assert.equal(promptWholeCache.lookup("", SCOPE, "0123456789abcdef"), undefined);
  });
});

/**
 * 2026-09-30 r3-cache-2：L1 的整串 KKV 行此前**每轮本地计数都重读一遍**
 * （JSON.parse + 全量回放 L1），与 L2 整表行同源同病（真机 12.5s）。这里给
 * L1 补上「每会话每进程只真读一次」的节流 + 「读失败/坏行撤销登记、下轮
 * 重试」的回收。
 *
 * 观测口径一律数 `token_chunks/promptWholeCache` 这一**键**的实际 get 次数
 * ——与 L2 的 `token_chunks/chunkCache` **同域不同键**，必须分别计数：共用
 * 一份计数会把 L2 的读算进 L1 头里（假绿），反过来也一样。
 */
describe("prompt-whole-cache L1 种子节流（r3-cache-2）", () => {
  const WHOLE_ROW_SESSION = "sess-l1-seed";

  beforeEach(() => {
    promptWholeCache.clearForTests();
  });

  /** 只数 L1 整串行（`token_chunks/promptWholeCache`）的 get / set 次数。 */
  function instrumentWholeRowKkv(options?: { failFirstGet?: boolean; badFirstGet?: boolean }): {
    kkv: SessionKkvService;
    gets: () => number;
    sets: () => number;
  } {
    const base = createFakeKkv();
    let gets = 0;
    let sets = 0;
    let firstGet = true;
    const isWholeRow = (domain: string, key: string): boolean =>
      domain === SESSION_KKV_DOMAIN_TOKEN_CHUNKS && key === PROMPT_WHOLE_CACHE_KEY;
    const kkv = {
      ...base,
      async get(sessionId: string, domain: string, key: string) {
        if (!isWholeRow(domain, key)) {
          return base.get(sessionId, domain, key);
        }
        gets += 1;
        if (firstGet) {
          firstGet = false;
          if (options?.failFirstGet === true) {
            throw new Error("db busy");
          }
          if (options?.badFirstGet === true) {
            return "{broken";
          }
        }
        return base.get(sessionId, domain, key);
      },
      async set(
        sessionId: string,
        domain: string,
        key: string,
        value: string
      ): Promise<void> {
        if (isWholeRow(domain, key)) sets += 1;
        await base.set(sessionId, domain, key, value);
      },
    };
    return { kkv, gets: () => gets, sets: () => sets };
  }

  /** 预置一条 L1 可解析的种子行（不经 record，直接写库模拟上次落盘）。 */
  async function seedWholeRow(
    kkv: SessionKkvService,
    sessionId: string,
    items: [string, string, number, string, boolean][]
  ): Promise<void> {
    await kkv.set(
      sessionId,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      PROMPT_WHOLE_CACHE_KEY,
      JSON.stringify({ v: 2, items })
    );
  }

  it("seed-once：连刷两轮同会话只发一次 L1 行 KKV 读（gets===1）", async () => {
    const probe = instrumentWholeRowKkv();
    await seedWholeRow(probe.kkv, WHOLE_ROW_SESSION, [
      ["aaaaaaaaaaaaaaaa", SCOPE, 4321, "tiktoken", false],
    ]);

    assert.equal(
      await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION),
      1,
      "首轮载入种子"
    );
    assert.equal(probe.gets(), 1, "首轮发一次 L1 行读");
    assert.deepEqual(promptWholeCache.lookup("", SCOPE, "aaaaaaaaaaaaaaaa"), {
      tokenCount: 4321,
      counterKind: "tiktoken",
      estimated: false,
    });

    assert.equal(
      await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION),
      0,
      "已 seed 的会话重复 seed 直接返回 0"
    );
    assert.equal(probe.gets(), 1, "第二轮不得再读 L1 行（r3-cache-2）");
    assert.deepEqual(
      promptWholeCache.lookup("", SCOPE, "aaaaaaaaaaaaaaaa"),
      { tokenCount: 4321, counterKind: "tiktoken", estimated: false },
      "重复 seed 无副作用（种子仍在 L1）"
    );
  });

  it("节流与 L2 相互独立：同域不同键，L2 那一行的读不计入 L1 计数", async () => {
    const probe = instrumentWholeRowKkv();
    await seedWholeRow(probe.kkv, WHOLE_ROW_SESSION, [
      ["bbbbbbbbbbbbbbbb", SCOPE, 11, "glm", false],
    ]);
    // L2 整表行与 L1 整串行同域（token_chunks）不同键：读它不得被算成 L1 的读，
    // 否则本护栏的 gets 会把 L2 的行为一起吞掉（去实现时看不出节流失效）。
    await probe.kkv.set(
      WHOLE_ROW_SESSION,
      SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
      TOKEN_CHUNKS_CACHE_KEY,
      JSON.stringify({ v: 2, items: [] })
    );
    assert.equal(
      await probe.kkv.get(
        WHOLE_ROW_SESSION,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        TOKEN_CHUNKS_CACHE_KEY
      ),
      JSON.stringify({ v: 2, items: [] })
    );
    assert.equal(probe.gets(), 0, "L2 键的读不计入 L1 计数（按 key 过滤）");

    assert.equal(await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION), 1);
    assert.equal(probe.gets(), 1, "只数 promptWholeCache 键");
    assert.equal(await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION), 0);
    assert.equal(probe.gets(), 1, "L1 自己的节流独立生效");
  });

  it("clearForTests 复位 seed-once：模拟进程重启后可重新 seed", async () => {
    const probe = instrumentWholeRowKkv();
    await seedWholeRow(probe.kkv, WHOLE_ROW_SESSION, [
      ["cccccccccccccccc", SCOPE, 7, "glm", false],
    ]);
    assert.equal(await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION), 1);
    assert.equal(probe.gets(), 1);

    promptWholeCache.clearForTests();
    assert.equal(
      await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION),
      1,
      "重启后重新 seed"
    );
    assert.equal(probe.gets(), 2);
  });

  it("L1 读抛错会撤销登记：第二轮仍发 KKV 读（gets===2）并成功载入", async () => {
    const probe = instrumentWholeRowKkv({ failFirstGet: true });
    await seedWholeRow(probe.kkv, WHOLE_ROW_SESSION, [
      ["dddddddddddddddd", SCOPE, 555, "glm", false],
    ]);

    const originalWarn = console.warn;
    console.warn = (): void => undefined;
    let seeded: number;
    try {
      seeded = await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(seeded, 0, "首轮读抛错：按无种子处理");
    assert.equal(probe.gets(), 1);
    assert.equal(
      promptWholeCache.lookup("", SCOPE, "dddddddddddddddd"),
      undefined,
      "读失败不得造数"
    );

    assert.equal(
      await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION),
      1,
      "读失败后第二轮应重试并载入"
    );
    assert.equal(probe.gets(), 2, "读失败不得永久登记成已 seed（r3-cache-2）");
    assert.equal(
      promptWholeCache.lookup("", SCOPE, "dddddddddddddddd")?.tokenCount,
      555
    );
  });

  it("L1 读到坏行同样撤销登记：下一轮读到正常行仍能载入（gets===2）", async () => {
    const probe = instrumentWholeRowKkv({ badFirstGet: true });
    await seedWholeRow(probe.kkv, WHOLE_ROW_SESSION, [
      ["eeeeeeeeeeeeeeee", SCOPE, 66, "tiktoken", false],
    ]);

    assert.equal(
      await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION),
      0,
      "首轮坏行：静默按无种子处理"
    );
    assert.equal(probe.gets(), 1);
    assert.equal(promptWholeCache.stats().entries, 0, "坏行不得载入任何条目");

    assert.equal(
      await promptWholeCache.seedFromKkv(probe.kkv, WHOLE_ROW_SESSION),
      1,
      "坏行后下一轮应重试"
    );
    assert.equal(probe.gets(), 2, "坏行不得永久登记成已 seed（r3-cache-2）");
    assert.equal(
      promptWholeCache.lookup("", SCOPE, "eeeeeeeeeeeeeeee")?.tokenCount,
      66
    );
  });

  it("未装配 sessionKkv：seedFromKkv 返回 0（未装配退化）", async () => {
    assert.equal(await promptWholeCache.seedFromKkv(undefined, WHOLE_ROW_SESSION), 0);
    assert.equal(await promptWholeCache.seedFromKkv(null, WHOLE_ROW_SESSION), 0);
  });
});
