/**
 * L2 块 token 平面缓存（message-token-cache 第二层，进程内跨会话单例）。
 *
 * 条目 `块hash16 × 计数器身份 → 块 token 数`：块文本经 `hashContent` 取前
 * 16 hex 作内容寻址键段（缓存层新增截断，非 hashContent 自带）；计数器身
 * 份（scope）由 {@link buildCounterScope} 从 vendorModelId / override /
 * family / driver 拼成——同文本不同词表计数不同，换模型/换端自动 miss。
 * 跨会话共享是刻意的：实测全库唯一块中 34.7% 重复，不同会话复用同一份
 * 块计数。
 *
 * **三代环形**：代 = 一次成功的本地计数周期。`record` 写当前代；
 * {@link tokenChunkCache.advanceGeneration} 每轮计数收尾推进（当前→二→
 * 三淘汰）；`lookup` 命中任意一代即算命中并**提升至当前代**。保留三代是
 * 为压缩/置位/回滚场景兜底——hidden 消息占 63.9%，隔一两代回到旧块集合
 * 仍可命中，第四代才淘汰。总量上限 {@link CHUNK_CACHE_MAX_TOTAL_ENTRIES}
 * （超限先淘汰最旧代；单代自身超限则按插入序淘汰最旧条目）。
 *
 * **KKV 持久化（转正）**：代际推进且该轮计数源于**真实刷新**（非预热）时，
 * 把推进前的当前代整表写 session KKV（域 `token_chunks`、键 `chunkCache`，
 * 紧凑 JSON，只写当前代）；{@link tokenChunkCache.seedFromKkv} 在进程重启
 * 后把整表载入为**最旧可用代**种子（不顶当前代）。坏 JSON / `v` 不符 /
 * 字段非法一律静默忽略（当 miss，模式抄 `session-api-prompt-token-store`
 * 的 parse 防御）；KKV 写失败只 warn 不抛——缓存是纯加速数据，持久化不该
 * 把计数路径打断。
 *
 * **每轮省掉整表链（2026-09-30 真机 12.5s 病根）**：整表是一条 MB 级 JSON
 * 链（读=整表 select + `JSON.parse` + 全量 Map 重建；写=整表序列化 + 覆盖
 * 写），历史消息多的会话一次本地计数就能把它走满一遍。两条止血：
 * - **seed-once**（{@link tokenChunkCache.seedFromKkv}）：每会话每进程只
 *   真读一次 KKV 行。热层里只会有更新的数据（我们自己覆盖写的就是最新一
 *   份），重复 seed 是纯粹的重复劳动。
 * - **脏标记跳过持久化**（`record` 置脏、{@link tokenChunkCache.advanceGeneration}
 *   消费）：本轮周期没有任何新块计数时，当前代与上一次落盘的内容一致，整表
 *   序列化 + 覆盖写整条省掉。**代际轮换照旧执行**（内存语义不变），只省持久化。
 *
 * 两处都只影响加速数据的落/读时机，不影响任何计数口径：漏种子或漏写只会
 * 让下次进程重启少一批种子块（重算一次），绝不会算错。
 *
 * @module infra/tokenizer/logic/token-chunk-cache
 */

import {
  SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
  TOKEN_CHUNKS_CACHE_KEY,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { TokenizerFamily } from "../ports/token-counter.port.js";
import type { TokenizerOverride } from "./resolve-tokenizer-family.js";

/** 块 hash 键段长度：hashContent（完整 64-hex sha256）截取前 16 hex。 */
const CHUNK_HASH_HEX_LENGTH = 16;

/** 三代总量条数上限（≈10MB 上限：100K × (16 hex 键 + number)）。 */
export const CHUNK_CACHE_MAX_TOTAL_ENTRIES = 100_000;

/** 持久化 JSON 版本号（`v` 不符的旧行整体按 miss 丢弃，无迁移）。 */
const TOKEN_CHUNKS_PAYLOAD_VERSION = 1;

/**
 * 计数器身份入参：决定「同一份块文本用哪套词表计数」的全部维度。
 *
 * 任一字段变化都会产生新 scope（旧条目自动失活），因此无需主动失效。
 */
export interface CounterScopeInput {
  readonly vendorModelId: string;
  readonly tokenizerOverride?: TokenizerOverride | null;
  readonly tokenizerFamily?: TokenizerFamily | null;
  readonly driverName?: string | null;
}

/**
 * 拼计数器身份（scope）：四段以字面 `\u0000` 六字符文本分隔——模型名 /
 * 驱动名理论上是自由字符串，该文本不会出现在标识符里，防「字段组合碰撞」。
 * 注：join 的实参是 `"\\u0000"`（源码双反斜杠，运行时为字面文本而非 NUL），
 * 功能等价；**勿改成真 NUL**——会整体更换 scope 键、全部 L1/L2/KKV 缓存
 * 一次性 miss。
 */
export function buildCounterScope(input: CounterScopeInput): string {
  return [
    input.vendorModelId,
    input.tokenizerOverride ?? "",
    input.tokenizerFamily ?? "",
    input.driverName ?? "",
  ].join("\\u0000");
}

/**
 * 块内容寻址键段：`hashContent(块文本)`（sha256 完整 64-hex）取前 16 hex。
 *
 * 16 hex = 64 bit：100K 量级条目下碰撞概率可忽略（生日界 ~2^32 条才显著），
 * 且即便碰撞也只是读错一个块的计数（误差个位数 token），属可接受的缓存
 * 风险。
 */
export function chunkHash16(chunk: string): string {
  return hashContent(chunk).slice(0, CHUNK_HASH_HEX_LENGTH);
}

/** 完整条目键：`l2:${hash16}:${scope}`（hash16 恒 16 字符，可无损拆回）。 */
function buildEntryKey(hash16: string, scope: string): string {
  return `l2:${hash16}:${scope}`;
}

/** 从完整键拆回 [hash16, scope]（依赖 hash16 定长 16 的事实）。 */
function splitEntryKey(key: string): [string, string] {
  return [key.slice(3, 3 + CHUNK_HASH_HEX_LENGTH), key.slice(4 + CHUNK_HASH_HEX_LENGTH)];
}

/** advanceGeneration 的持久化选项。 */
export interface AdvanceGenerationOptions {
  /**
   * 持久化通道：`sessionKkv` 缺省（未装配 / 测试未注入）时只推进代际、
   * 不落库，行为与无持久化前完全一致。
   */
  readonly persist?: {
    readonly sessionKkv: SessionKkvService | null | undefined;
  };
  /**
   * 本轮计数是否源于**真实刷新**（非预热）。只有真实刷新才写 KKV——预热
   * 批量灌入的计数不代表用户可见的稳定状态，避免写放大。
   */
  readonly realRefresh?: boolean;
}

/** 持久化条目三元组：`[hash16, scope, count]`。 */
export type TokenChunkCacheItem = readonly [
  hash16: string,
  scope: string,
  count: number
];

// ---- 三代环形状态（index 越小越新：0=当前代，1=第二代，2=第三代） ----
let genCurrent = new Map<string, number>();
let genSecond = new Map<string, number>();
let genThird = new Map<string, number>();

let maxTotalEntries = CHUNK_CACHE_MAX_TOTAL_ENTRIES;
let hits = 0;
let misses = 0;

/**
 * 已完成 KKV 种子载入的会话（每会话每进程只 seed 一次）。
 *
 * 该 KKV 行在本进程内只会被 {@link tokenChunkCache.advanceGeneration} 的
 * 覆盖写更新，写出去的就是更完整的一份；重复读回来 parse + 重建只是把热层
 * 已有（且更新鲜）的数据又灌一遍最旧代。漏 seed 的唯一后果是跨重启少一批
 * 种子块（首次计数重算），口径不受影响。
 */
const seededSessions = new Set<string>();

/**
 * 当前代自上次**安排**持久化以来是否有过新记录（`record` 置位）。
 *
 * false ⇒ 当前代与上次落盘的内容逐条相同，整表序列化 + 覆盖写纯浪费，跳过。
 * 注意只被 `record` 置位：`lookup` 的「提升至当前代」不改任何计数，漏记它
 * 最多让某条块计数不进这次的种子表（下次重启重算一次），不值得为它每轮多
 * 写一次整表。
 */
let currentGenDirty = false;

/** 总量超限时淘汰：先清最旧代，仍超再清次旧代，最后按插入序裁当前代。 */
function enforceTotalCap(): void {
  let total = genCurrent.size + genSecond.size + genThird.size;
  if (total <= maxTotalEntries) {
    return;
  }
  genThird.clear();
  total = genCurrent.size + genSecond.size;
  if (total <= maxTotalEntries) {
    return;
  }
  genSecond.clear();
  // 单代自身超限（测试注入小上限时的路径）：按插入序删当前代最旧条目。
  while (genCurrent.size > maxTotalEntries) {
    const oldest = genCurrent.keys().next();
    if (oldest.done === true) {
      break;
    }
    genCurrent.delete(oldest.value);
  }
}

/**
 * 序列化当前代整表为紧凑 JSON：`{v:1, items:[[hash16,scope,count],...]}`。
 * 当前代为空时返回 `null`（空表不落库）。
 *
 * 归属语义与 promptWholeCache 同形态（CR 收窄口径）：缓存平面跨会话共享
 * （键 = 内容指纹 × scope），整表按当前调用方 sessionId 落行——落哪个会话
 * 行只影响加速续命位置、无脏读；会话删除级联只丢加速不丢正确性。tc spec
 * 「把当前代整表写 session KKV」为该形态的字面背书。
 */
function serializeCurrentGeneration(): string | null {
  if (genCurrent.size === 0) {
    return null;
  }
  const items: [string, string, number][] = [];
  for (const [key, count] of genCurrent) {
    const [hash16, scope] = splitEntryKey(key);
    items.push([hash16, scope, count]);
  }
  return JSON.stringify({ v: TOKEN_CHUNKS_PAYLOAD_VERSION, items });
}

/**
 * 解析持久化整表；缺失 / 损坏 / `v` 不符 / 任一条目字段非法 → 整体 null
 * （静默按 miss，不抛错、不造数）。未知键一律忽略（兼容未来加字段）。
 */
export function parseTokenChunkCachePayload(
  raw: string | null | undefined
): TokenChunkCacheItem[] | null {
  if (raw == null || raw.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object") {
    return null;
  }
  const { v, items } = parsed as { v?: unknown; items?: unknown };
  if (v !== TOKEN_CHUNKS_PAYLOAD_VERSION) {
    return null;
  }
  if (!Array.isArray(items)) {
    return null;
  }
  const out: TokenChunkCacheItem[] = [];
  for (const item of items) {
    if (!Array.isArray(item) || item.length < 3) {
      return null;
    }
    const [hash16, scope, count] = item as [unknown, unknown, unknown];
    if (
      typeof hash16 !== "string" ||
      hash16.length !== CHUNK_HASH_HEX_LENGTH ||
      !/^[0-9a-f]+$/.test(hash16)
    ) {
      return null;
    }
    if (typeof scope !== "string" || scope.length === 0) {
      return null;
    }
    if (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count < 0
    ) {
      return null;
    }
    out.push([hash16, scope, count]);
  }
  return out;
}

/**
 * L2 平面缓存单例（进程内、跨会话共享）。
 */
export const tokenChunkCache = {
  /**
   * 查一块的 token 数：命中任意一代即算命中并提升至当前代（回滚/压缩场景
   * 的旧块被再次触碰时「续命」）；三代皆 miss 返回 `undefined`，由调用方
   * 现算（`countTextWithIncrementalTokenizer`）后 record。
   */
  lookup(hash16: string, scope: string): number | undefined {
    const key = buildEntryKey(hash16, scope);
    const current = genCurrent.get(key);
    if (current !== undefined) {
      hits += 1;
      return current;
    }
    for (const gen of [genSecond, genThird]) {
      const count = gen.get(key);
      if (count !== undefined) {
        // 提升至当前代：从旧代摘除、写当前代（下一次推进才再往后挪）。
        gen.delete(key);
        genCurrent.set(key, count);
        hits += 1;
        return count;
      }
    }
    misses += 1;
    return undefined;
  },

  /** 记一块的 token 数（写当前代，覆盖同键旧值），随后执行总量上限淘汰。 */
  record(hash16: string, scope: string, count: number): void {
    genCurrent.set(buildEntryKey(hash16, scope), count);
    currentGenDirty = true;
    enforceTotalCap();
  },

  /**
   * 推进一代（当前→二→三淘汰），一轮整 prompt 计数收尾调用一次。
   *
   * 当 `options.persist.sessionKkv` 存在、`options.realRefresh === true`
   * **且本轮周期有过新记录**（`currentGenDirty`）时，把**推进前**的当前代
   * 整表（即刚完成的这轮计数周期）序列化写 session KKV（域 `token_chunks`、
   * 键 `chunkCache`）。写是 fire-and-forget：失败只 warn——缓存持久化不值得
   * 打断计数路径。
   *
   * 无新记录的轮次跳过序列化与写入（整表内容与上次落盘逐条相同）；**代际
   * 轮换在任何分支都照旧执行**，内存语义与优化前完全一致。
   */
  advanceGeneration(
    sessionId: string,
    options?: AdvanceGenerationOptions
  ): void {
    const sessionKkv = options?.persist?.sessionKkv;
    const payload =
      sessionKkv != null && options?.realRefresh === true && currentGenDirty
        ? serializeCurrentGeneration()
        : null;

    // 三代环形轮换：第三代淘汰后清空复用为新当前代（省一次分配）。
    const evicted = genThird;
    evicted.clear();
    genThird = genSecond;
    genSecond = genCurrent;
    genCurrent = evicted;

    if (sessionKkv != null && payload != null) {
      // 脏标记在**安排**写入后即清（不等落库结果）：整表写入是 fire-and-forget
      // 的覆盖写，没有重试语义；等落库反而会让写失败时下一轮又付一次整表代价。
      currentGenDirty = false;
      void sessionKkv
        .set(sessionId, SESSION_KKV_DOMAIN_TOKEN_CHUNKS, TOKEN_CHUNKS_CACHE_KEY, payload)
        .catch((error) => {
          console.warn(
            `[novel-master/token-chunk-cache] token_chunks KKV 写入失败（session=${sessionId}）`,
            error
          );
        });
    }
  },

  /**
   * 从 session KKV 载入持久化整表为**最旧可用代**种子（第三代，不顶当前
   * 代——热层当前代的条目更新鲜）。返回载入条数；KKV 行缺失 / 坏 JSON /
   * `v` 不符 / 字段非法 / 读库异常一律静默返回 0（按无种子处理，不抛错）。
   *
   * **每会话每进程只真读一次**（2026-09-30 真机 12.5s 止血）：已 seed 过的
   * 会话直接返回 0，连 `sessionKkv.get` 都不发——该行在本进程内只会被
   * {@link tokenChunkCache.advanceGeneration} 覆盖成更新的内容，重复读只是把
   * 热层已有的数据再 parse 一遍。`clearForTests` 会复位这份记录。
   *
   * **失败可重试（2026-09-30 r3-l2-1）**：读抛错、以及「行存在但解析不出来」
   * （截断 / `v` 不符 / 字段非法）两个失败分支都**撤销登记**
   * （`seededSessions.delete(sessionId)` 再 return 0）——seed-once 的登记只
   * 在「这次读确实成功，或库里确实没这一行」时才有资格留下。库忙、连接瞬断、
   * 并发写坏行都是瞬态，一次读错就锁死整个进程内该会话的跨重启续命（每轮
   * 都白付一次整表读、又永远拿不到种子）是最坏结果。留下的代价：库里长期是
   * 坏行时每轮都会重试一次整表读（与 12.5s 止血目标相反），但「加速」让位于
   * 「正确性」，且坏行属于应当被上游写侧修掉的异常形态，不是常态。
   */
  async seedFromKkv(
    sessionKkv: SessionKkvService | null | undefined,
    sessionId: string
  ): Promise<number> {
    if (sessionKkv == null) {
      return 0;
    }
    if (seededSessions.has(sessionId)) {
      return 0;
    }
    // 先登记再 await：并发调用也只发一次读（同一行读两遍没有意义）。
    seededSessions.add(sessionId);
    let raw: string | null;
    try {
      raw = await sessionKkv.get(
        sessionId,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        TOKEN_CHUNKS_CACHE_KEY
      );
    } catch (error) {
      console.warn(
        `[novel-master/token-chunk-cache] token_chunks KKV 读取失败（session=${sessionId}），按无种子处理`,
        error
      );
      // 撤销登记：读失败是瞬时的，不撤销则本进程内该会话永远失去种子。
      seededSessions.delete(sessionId);
      return 0;
    }
    const items = parseTokenChunkCachePayload(raw);
    if (items == null) {
      // 只有「行存在但坏」（截断 / 版本不符 / 字段非法）才撤销登记：那种行
      // 可能是别的写入方瞬态写坏、随后被修好，留着登记会让本进程永久按
      // 「无种子」处理。**行不存在（首次运行/该会话还没落过盘）不是失败**——
      // 那就是「本来就没东西可 seed」，撤销登记等于把 seed-once 整个废掉
      // （此后每轮都白读一次整表，正是本次要治的病）。
      if (raw != null && raw.length > 0) {
        seededSessions.delete(sessionId);
      }
      return 0;
    }
    for (const [hash16, scope, count] of items) {
      // 合并进最旧代：同键以种子覆盖（种子即该会话最近一次落盘的当前代）。
      genThird.set(buildEntryKey(hash16, scope), count);
    }
    enforceTotalCap();
    return items.length;
  },

  /**
   * 测试用：清空三代与命中计数，并恢复默认总量上限。
   *
   * 同时复位 {@link seededSessions} 与脏标记——否则 seed-once 会让「模拟进程
   * 重启后重新 seed」的后续用例静默按已 seed 处理。
   */
  clearForTests(): void {
    genCurrent.clear();
    genSecond.clear();
    genThird.clear();
    hits = 0;
    misses = 0;
    maxTotalEntries = CHUNK_CACHE_MAX_TOTAL_ENTRIES;
    seededSessions.clear();
    currentGenDirty = false;
  },

  /** 测试用：注入小总量上限（clearForTests 会恢复默认值）。 */
  setMaxTotalEntriesForTests(max: number): void {
    maxTotalEntries = max;
    enforceTotalCap();
  },

  /** 观测用：命中/未命中计数、总条数与各代条数（[当前, 第二, 第三]）。 */
  stats(): {
    hits: number;
    misses: number;
    total: number;
    genCounts: [number, number, number];
  } {
    return {
      hits,
      misses,
      total: genCurrent.size + genSecond.size + genThird.size,
      genCounts: [genCurrent.size, genSecond.size, genThird.size],
    };
  },
} as const;
