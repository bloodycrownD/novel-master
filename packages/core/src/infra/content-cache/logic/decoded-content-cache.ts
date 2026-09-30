/**
 * 进程内解压产物缓存（统一层，2026-09-30 用户拍板「缓存解压后结果」）。
 *
 * 项目里凡「压缩落库、读时解压」的正文都付两笔钱：SQL 读压缩字节 +
 * zlib 解压（Hermes 纯 JS inflate 是数倍放大，实测占读链 90%+ 成本）。
 * 而同一份内容被反复读取的场景非常密集：
 * - workplace 常驻前缀：每次进会话 / 每次 chip 刷新都把同一批文件正文
 *   再解压一遍（暖组装几百 ms 全在这里）；
 * - 消息正文：token 组装、转录展示、发送前奏、用量弹窗工具计数各读各的，
 *   同一批可见消息一天要解压几十遍。
 *
 * 本模块把这些**解压后的产物**按内容身份收进进程内 LRU，作为唯一一层
 * （不是每个读口一份补丁）：谁先读谁付一次解压，之后全是内存命中。
 * 三个读口共用本层——vfs content-store、session-kkv file_cache、
 * chat_message 正文解码。
 *
 * ## 两个池，两种身份
 *
 * - **内容正文池**（`contentBodyPool`）：键 = 明文 sha256 hex。`vfs_content_blob`
 *   与 `session_file_cache_blob` 的 content_hash 都是 `hashContent(明文)`
 *   （同一个纯函数），所以同一位文件正文在两套存储里天然同键——一份内存
 *   同时服务 vfs.read（文件预览 / 工具读盘 / workplace 冷回填）与 file_cache
 *   读链。**这池不需要任何失效机制**：键是内容的密码学哈希，同键必同值
 *   （value 是 key 的函数），不存在陈旧窗口——这就是用户要的「内容寻址」。
 * - **消息正文池**（`messageContentPool`）：键 = message id。chat_message 没有
 *   内容哈希列（曾有过加列方案，同日撤回），只能以主键为身份 + 写入点显式
 *   失效：唯一会「同 id 换正文」的写口是 `updateContent`，它必须调用
 *   {@link forgetDecodedMessageContent}。id 全仓 `randomUUID()` 生成、从不复用
 *   （append/fork/copy 均新 id），所以删除/回滚留下的死条目没有正确性风险，
 *   由 LRU 自然回收；后台压缩搬运与 blob 归一任务只换字节形态、正文不变，
 *   同样无需失效。
 *
 * ## 只存字符串，不存解析结果
 *
 * 池里存的是「解压产物」原样（文件正文 / 消息 blocks JSON 串），不是
 * parse 出来的对象：返回值会被多个消费方共享，存对象就等于把可变引用
 * 发到各处，谁改一下缓存就烂了。JSON.parse 本身远便宜于 inflate。
 *
 * ## 内存上界
 *
 * 双上界（条数 + 字符数）：正文条目体量差异极大（一条消息几百字节、
 * 一个文件几 MB），只按条数兜不住。超限逐出最旧（Map 迭代序 = 插入序，
 * 命中时先删再插刷新 LRU）。单条超过整个池预算的**不收录**——收录即把
 * 别的条目全逐出去、下次读自己又被逐出，纯抖动。预算必须大于「一次
 * 会话的可见工作集」，否则顺序扫描会把自己逐出去退化成 0 命中。
 *
 * @module infra/content-cache/logic/decoded-content-cache
 */

/** 单池上界与命名（name 只进诊断输出，用于定位是哪层在抖）。 */
export interface DecodedContentPoolLimits {
  readonly name: string;
  readonly maxEntries: number;
  readonly maxChars: number;
}

/** 池快照（测试与诊断观测面）。 */
export interface DecodedContentPoolStats {
  readonly name: string;
  readonly entries: number;
  readonly chars: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

/**
 * 一个带双上界的 LRU 字符串池。
 *
 * @remarks 导出是为了可直测 LRU / 预算行为；生产接线只用本模块顶部的
 * 两个单例池与那组 lookup/remember 函数，不需要自己 new。
 */
export class DecodedContentPool {
  /** 迭代序 = 插入序：命中先删再插即 LRU 刷新，逐出取最前键。 */
  private readonly lru = new Map<string, string>();
  private chars = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(private readonly limits: DecodedContentPoolLimits) {}

  /** 命中返回缓存值（含空串）；miss 返回 null。 */
  get(key: string): string | null {
    const hit = this.lru.get(key);
    if (hit == null) {
      this.misses++;
      return null;
    }
    this.lru.delete(key);
    this.lru.set(key, hit);
    this.hits++;
    return hit;
  }

  set(key: string, value: string): void {
    if (value.length > this.limits.maxChars) {
      // 单条吃不下整个预算：不收录（见模块头「不收录」段），并清掉可能
      // 存在的旧值，避免旧值占着预算不放。
      this.delete(key);
      return;
    }
    const previous = this.lru.get(key);
    if (previous != null) {
      this.lru.delete(key);
      this.chars -= previous.length;
    }
    this.lru.set(key, value);
    this.chars += value.length;
    this.evictOverBudget();
  }

  delete(key: string): void {
    const previous = this.lru.get(key);
    if (previous == null) {
      return;
    }
    this.lru.delete(key);
    this.chars -= previous.length;
  }

  /** 清空条目与计数器（整体归零，测试隔离用）。 */
  clear(): void {
    this.lru.clear();
    this.chars = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  stats(): DecodedContentPoolStats {
    return {
      name: this.limits.name,
      entries: this.lru.size,
      chars: this.chars,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private evictOverBudget(): void {
    while (
      this.lru.size > this.limits.maxEntries ||
      this.chars > this.limits.maxChars
    ) {
      const oldest = this.lru.keys().next().value;
      if (oldest == null) {
        return;
      }
      this.delete(oldest);
      this.evictions++;
    }
  }
}

/**
 * 内容正文池预算：8M 字符（UTF-16 计 ≈ 16MB 上限）。
 *
 * 标定口径：novel 项目的 workplace 是「几百 KB ~ 几 MB 的规则文件集」，
 * 压缩会话的可见消息集同量级；8M 字符足以一次容纳完整工作集，保住
 * 「顺序扫一遍即全部常驻」的命中形态。真要调小，先确认最大工作集
 * ——池小于工作集会退化成 0 命中（见模块头）。
 */
const CONTENT_BODY_POOL_MAX_CHARS = 8_000_000;
const CONTENT_BODY_POOL_MAX_ENTRIES = 1024;

/**
 * 消息正文池预算：4M 字符 + 4096 条。
 *
 * 条数上界对齐「千条级会话的可见消息集」；字符上界同时兜长正文会话
 * （单条 20KB × 数百条 ≈ 数 M 字符）。
 */
const MESSAGE_CONTENT_POOL_MAX_CHARS = 4_000_000;
const MESSAGE_CONTENT_POOL_MAX_ENTRIES = 4096;

const contentBodyPool = new DecodedContentPool({
  name: "content-body",
  maxEntries: CONTENT_BODY_POOL_MAX_ENTRIES,
  maxChars: CONTENT_BODY_POOL_MAX_CHARS,
});

const messageContentPool = new DecodedContentPool({
  name: "message-content",
  maxEntries: MESSAGE_CONTENT_POOL_MAX_ENTRIES,
  maxChars: MESSAGE_CONTENT_POOL_MAX_CHARS,
});

/**
 * 查内容正文（键 = 明文 sha256 hex，两套内容寻址存储共用）。
 *
 * @remarks 传 `vfs_content_blob` / `session_file_cache_blob` 的 content_hash；
 * 不需要也不允许按会话隔离——同 hash 必同正文。
 */
export function lookupDecodedContentBody(contentHash: string): string | null {
  return contentBodyPool.get(contentHash);
}

/**
 * 回填内容正文。
 *
 * @remarks 调用方保证 `contentHash === hashContent(body)`（两套存储的写侧
 * 都是这么算的）；喂错键等于投毒，本层不做校验（校验就得再哈希一遍，
 * 正是本层要消灭的线性成本）。
 */
export function rememberDecodedContentBody(
  contentHash: string,
  body: string
): void {
  contentBodyPool.set(contentHash, body);
}

/** 查消息正文 JSON（键 = message id；口径见模块头「消息正文池」）。 */
export function lookupDecodedMessageContent(messageId: string): string | null {
  return messageContentPool.get(messageId);
}

/**
 * 回填消息正文 JSON。
 *
 * @param json blocks JSON 明文（`decodeMessageContent` 的产物形态）。
 */
export function rememberDecodedMessageContent(
  messageId: string,
  json: string
): void {
  messageContentPool.set(messageId, json);
}

/**
 * 失效一条消息正文（**同 id 换正文的唯一写口 updateContent 必须调用**）。
 *
 * @remarks 删除/回滚不调用：id 不复用，死条目由 LRU 回收（模块头）。
 */
export function forgetDecodedMessageContent(messageId: string): void {
  messageContentPool.delete(messageId);
}

/** 仅测试与诊断：清空两池（条目与计数器一并归零，保证用例隔离）。 */
export function clearDecodedContentCaches(): void {
  contentBodyPool.clear();
  messageContentPool.clear();
}

/** 两池快照（测试断言命中形态 / 排查内存占用时用）。 */
export function decodedContentCacheStats(): readonly DecodedContentPoolStats[] {
  return [contentBodyPool.stats(), messageContentPool.stats()];
}
