/**
 * L1 会话级整串 prompt 计数缓存（message-token-cache 第一层，进程内 Map）。
 *
 * 挡的是「无变更重复刷新」：同一会话内内容与计数器身份都没变的整 prompt
 * 计数（chip 刷新、压缩评估反复触发）直接命中返回，不再进入 L2 分块求和。
 *
 * - **键**：`l1:${sessionId}:${计数器身份(scope)}:${内容指纹}`——内容指纹
 *   由调用方对「整串+tools 串」拼接后取 hashContent 传入（spec 计数流程
 *   L1 口径）；内容或身份任一变化都换键，天然失效、无脏读。
 * - **LRU 会话级 32 条**：同一会话最近 32 个「内容×身份」组合。上限取的
 *   是回滚/编辑场景下同会话在少数几个内容版本间来回切换的窗口——超出即
 *   淘汰最旧，单会话内存占用恒有界。
 * - **KKV 持久化（重启续命）**：native 档（WEB/SP 过桥）只有 L1 可用且
 *   原生整串计数很贵（glm 139KB 实测 5.8s），进程重启 L1 清零会让重进
 *   会话必再付一次。`record` 顺带把 `estimated:false` 的精确档条目收进
 *   pending 列表；读口（resolve-current-prompt-tokens）在计数前后调
 *   {@link promptWholeCache.seedFromKkv} / {@link promptWholeCache.persistPendingWrites}
 *   把整串计数经 session KKV（token_chunks 域 `promptWholeCache` 键，
 *   ≤16 条环形）跨重启续命。只收精确档：heuristic 条目可能源于
 *   「cl100k 表暂缺」的瞬态，持久化会把降级读数固化成重启后的长期读数。
 *   **归属语义（跨会话共享，CR 收窄口径）**：pending 列表全局收集、不带
 *   sessionId，persist 时归入**最近一次调用 persist 的会话**行——条目键为
 *   内容指纹 × 计数器身份（内容寻址），落哪个会话行只影响加速续命位置、
 *   无脏读；会话删除的级联清理会连带丢他会话条目，**只丢加速不丢正确性**
 *   （下次计数重算即可）。
 *
 * @module infra/tokenizer/logic/prompt-whole-cache
 */

import {
  PROMPT_WHOLE_CACHE_KEY,
  SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import type { TokenCounterKind } from "../ports/token-counter.port.js";

/** L1 缓存条目：一次整 prompt 本地计数的完整结果（口径三件套）。 */
export interface PromptWholeCacheEntry {
  readonly tokenCount: number;
  readonly counterKind: TokenCounterKind;
  readonly estimated: boolean;
}

/** 单会话 LRU 条数上限（同会话最近 32 个「内容×身份」组合）。 */
export const PROMPT_WHOLE_CACHE_LRU_PER_SESSION = 32;

/** 每会话持久化条数上限（回滚/编辑的少数内容版本窗口）。 */
const PERSIST_MAX_ITEMS = 16;

/** 持久化 JSON 版本号（`v` 不符的旧行整体按 miss 丢弃，无迁移）。 */
const PERSIST_PAYLOAD_VERSION = 1;

/** 持久化条目五元组：`[hash16, scope, count, kind, est]`。 */
type PersistItem = readonly [
  hash16: string,
  scope: string,
  count: number,
  kind: string,
  est: boolean
];

/** 会话桶：Map 迭代序即插入序——首键最旧、末键最新，LRU 据此淘汰。 */
const buckets = new Map<string, Map<string, PromptWholeCacheEntry>>();

/** record() 顺带收集的待持久化条目（读口计数后取走合并落库）。 */
const pendingWrites: {
  scope: string;
  contentHash: string;
  entry: PromptWholeCacheEntry;
}[] = [];

/** 每会话已持久化的条目表（seed 时初始化；persist 合并去重后覆盖）。 */
const persistedItems = new Map<string, PersistItem[]>();

/** 完整缓存键：`l1:${sessionId}:${scope}:${contentHash}`。 */
function buildWholeCacheKey(
  sessionId: string,
  scope: string,
  contentHash: string
): string {
  return `l1:${sessionId}:${scope}:${contentHash}`;
}

/** 惰性取会话桶（不存在则建空桶并挂载）。 */
function ensureBucket(sessionId: string): Map<string, PromptWholeCacheEntry> {
  let bucket = buckets.get(sessionId);
  if (bucket == null) {
    bucket = new Map();
    buckets.set(sessionId, bucket);
  }
  return bucket;
}

/** 桶超限时从最旧端淘汰，直至回到上限内。 */
function evictToLimit(bucket: Map<string, PromptWholeCacheEntry>): void {
  while (bucket.size > PROMPT_WHOLE_CACHE_LRU_PER_SESSION) {
    const oldest = bucket.keys().next();
    if (oldest.done === true) {
      break;
    }
    bucket.delete(oldest.value);
  }
}

/** record 的去重路径：只写桶，不收集 pending（seed 回放不产生新持久化）。 */
function recordEntryIntoBucket(
  sessionId: string,
  scope: string,
  contentHash: string,
  entry: PromptWholeCacheEntry
): void {
  const bucket = ensureBucket(sessionId);
  const key = buildWholeCacheKey(sessionId, scope, contentHash);
  bucket.delete(key);
  bucket.set(key, entry);
  evictToLimit(bucket);
}

/** 两张持久化表是否同序同值（判定「无变化不写库」）。 */
function sameItems(a: readonly PersistItem[], b: readonly PersistItem[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, i) => JSON.stringify(item) === JSON.stringify(b[i]));
}

/**
 * 解析持久化 payload；缺失 / 损坏 / `v` 不符 / 任一条目字段非法 → 整体
 * null（静默按 miss）。只接受 `est===false` 形态（写入侧同样只收精确档）。
 */
function parsePersistPayload(raw: string | null | undefined): PersistItem[] | null {
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
  if (v !== PERSIST_PAYLOAD_VERSION || !Array.isArray(items)) {
    return null;
  }
  const out: PersistItem[] = [];
  for (const item of items) {
    if (!Array.isArray(item) || item.length !== 5) {
      return null;
    }
    const [hash16, scope, count, kind, est] = item as [
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    ];
    if (
      typeof hash16 !== "string" ||
      !/^[0-9a-f]{16}$/.test(hash16) ||
      typeof scope !== "string" ||
      scope.length === 0 ||
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count < 0 ||
      typeof kind !== "string" ||
      kind.length === 0 ||
      est !== false
    ) {
      return null;
    }
    out.push([hash16, scope, count, kind, false]);
  }
  return out;
}

/**
 * 进程内 L1 单例：lookup 命中会提升 LRU 新鲜度；record 覆盖写并淘汰超限
 * 旧条目。
 */
export const promptWholeCache = {
  /**
   * 查一条整串计数。命中即把该键提升为会话桶内最新（LRU）；miss 返回
   * `undefined`，由调用方进入 L2 分块路径。
   */
  lookup(
    sessionId: string,
    scope: string,
    contentHash: string
  ): PromptWholeCacheEntry | undefined {
    const bucket = buckets.get(sessionId);
    if (bucket == null) {
      return undefined;
    }
    const key = buildWholeCacheKey(sessionId, scope, contentHash);
    const entry = bucket.get(key);
    if (entry == null) {
      return undefined;
    }
    // LRU 提升：删掉重插，移到迭代序末尾（最新端）。
    bucket.delete(key);
    bucket.set(key, entry);
    return entry;
  },

  /** 写一条整串计数（覆盖同键旧值并提升新鲜度），随后按会话级 LRU 淘汰。 */
  record(
    sessionId: string,
    scope: string,
    contentHash: string,
    entry: PromptWholeCacheEntry
  ): void {
    const bucket = ensureBucket(sessionId);
    const key = buildWholeCacheKey(sessionId, scope, contentHash);
    bucket.delete(key);
    bucket.set(key, entry);
    evictToLimit(bucket);
    if (entry.estimated === false) {
      pendingWrites.push({ scope, contentHash, entry });
      if (pendingWrites.length > PERSIST_MAX_ITEMS) {
        pendingWrites.splice(0, pendingWrites.length - PERSIST_MAX_ITEMS);
      }
    }
  },

  /**
   * 从 session KKV 载入该会话的持久化整串条目并 seed 回 L1（记入 `""`
   * 会话桶——驱动内部查 L1 用的就是这个桶；条目按内容指纹寻址，跨会话
   * 共享安全）。坏 JSON / 版本不符 / 字段非法一律静默忽略。返回载入条数。
   */
  async seedFromKkv(
    sessionKkv: SessionKkvService | null | undefined,
    sessionId: string
  ): Promise<number> {
    if (sessionKkv == null) {
      return 0;
    }
    let raw: string | null;
    try {
      raw = await sessionKkv.get(
        sessionId,
        SESSION_KKV_DOMAIN_TOKEN_CHUNKS,
        PROMPT_WHOLE_CACHE_KEY
      );
    } catch (error) {
      console.warn(
        "[novel-master/prompt-whole-cache] promptWhole KKV 读取失败，按无种子处理",
        error
      );
      return 0;
    }
    const items = parsePersistPayload(raw);
    if (items == null) {
      persistedItems.delete(sessionId);
      return 0;
    }
    for (const [hash16, scope, count, kind] of items) {
      recordEntryIntoBucket("", scope, hash16, {
        tokenCount: count,
        counterKind: kind as TokenCounterKind,
        estimated: false,
      });
    }
    persistedItems.set(sessionId, items);
    return items.length;
  },

  /**
   * 取走 pending 写、合并进该会话的持久化表（新条目置顶、按 hash+scope 去重、
   * 上限 16 条）并覆盖写 KKV。payload 无变化（本轮全是 L1 命中、无新条目）
   * 时不写库。fire-and-forget：写失败只 warn（缓存持久化不打断计数路径）。
   */
  persistPendingWrites(
    sessionKkv: SessionKkvService | null | undefined,
    sessionId: string
  ): void {
    const batch = pendingWrites.splice(0, pendingWrites.length);
    if (sessionKkv == null || batch.length === 0) {
      return;
    }
    const items = persistedItems.get(sessionId) ?? [];
    const merged: PersistItem[] = [];
    for (const write of batch) {
      merged.unshift([
        write.contentHash,
        write.scope,
        write.entry.tokenCount,
        write.entry.counterKind,
        false,
      ]);
    }
    for (const item of items) {
      if (
        merged.some(([hash16, scope]) => hash16 === item[0] && scope === item[1])
      ) {
        continue;
      }
      merged.push(item);
    }
    merged.splice(PERSIST_MAX_ITEMS);
    if (sameItems(merged, items)) {
      persistedItems.set(sessionId, merged);
      return;
    }
    persistedItems.set(sessionId, merged);
    const payload = JSON.stringify({ v: PERSIST_PAYLOAD_VERSION, items: merged });
    void sessionKkv
      .set(sessionId, SESSION_KKV_DOMAIN_TOKEN_CHUNKS, PROMPT_WHOLE_CACHE_KEY, payload)
      .catch((error) => {
        console.warn(
          "[novel-master/prompt-whole-cache] promptWhole KKV 写入失败",
          error
        );
      });
  },

  /** 清掉一个会话的全部 L1 条目（会话删除 / 失效路径）。 */
  clearSession(sessionId: string): void {
    buckets.delete(sessionId);
    persistedItems.delete(sessionId);
  },

  /** 测试用：清空全部会话桶。 */
  clearForTests(): void {
    buckets.clear();
    pendingWrites.length = 0;
    persistedItems.clear();
  },

  /** 观测用：会话桶数与总条目数。 */
  stats(): { sessions: number; entries: number } {
    let entries = 0;
    for (const bucket of buckets.values()) {
      entries += bucket.size;
    }
    return { sessions: buckets.size, entries };
  },
} as const;
