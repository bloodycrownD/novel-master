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
 * - 纯进程内、不持久化：进程重启后 miss 走 L2 重算属预期（L2 有 KKV 种子）。
 *
 * @module infra/tokenizer/logic/prompt-whole-cache
 */

import type { TokenCounterKind } from "../ports/token-counter.port.js";

/** L1 缓存条目：一次整 prompt 本地计数的完整结果（口径三件套）。 */
export interface PromptWholeCacheEntry {
  readonly tokenCount: number;
  readonly counterKind: TokenCounterKind;
  readonly estimated: boolean;
}

/** 单会话 LRU 条数上限（同会话最近 32 个「内容×身份」组合）。 */
export const PROMPT_WHOLE_CACHE_LRU_PER_SESSION = 32;

/** 会话桶：Map 迭代序即插入序——首键最旧、末键最新，LRU 据此淘汰。 */
const buckets = new Map<string, Map<string, PromptWholeCacheEntry>>();

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
  },

  /** 清掉一个会话的全部 L1 条目（会话删除 / 失效路径）。 */
  clearSession(sessionId: string): void {
    buckets.delete(sessionId);
  },

  /** 测试用：清空全部会话桶。 */
  clearForTests(): void {
    buckets.clear();
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
