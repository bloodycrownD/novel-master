/**
 * 进程内解压产物缓存（统一层，2026-09-30 用户拍板「缓存解压后结果」）。
 *
 * 项目里凡「压缩落库、读时解压」的正文都付两笔钱：SQL 读压缩字节 +
 * zlib 解压（Hermes 纯 JS inflate 是数倍放大，实测占读链 90%+ 成本）。
 * 而同一份内容被反复读取的场景非常密集：
 * - workplace 常驻前缀：每次进会话 / 每次 chip 刷新都把同一批文件正文
 *   再解压一遍（暖组装几百 ms 全在这里）。
 *
 * 本模块把**解压后的产物**按内容身份收进进程内 LRU，作为唯一一层
 * （不是每个读口一份补丁）：谁先读谁付一次解压，之后全是内存命中。
 *
 * ## 单池：内容正文池（contentBodyPool）
 *
 * 键 = 明文 sha256 hex。`vfs_content_blob` 与 `session_file_cache_blob`
 * 的 content_hash 都是 `hashContent(明文)`（同一个纯函数），所以同一位文件
 * 正文在两套存储里天然同键——一份内存同时服务 vfs.read（文件预览 / 工具
 * 读盘 / workplace 冷回填）与 file_cache 读链。**这池不需要任何失效
 * 机制**：键是内容的密码学哈希，同键必同值（value 是 key 的函数），不存在
 * 陈旧窗口——这就是用户要的「内容寻址」。注意「命中不查库」的后果：某条
 * blob 行被 GC 回收后，同进程内照样读得到该正文（正文正确性由 hash 保证，
 * 与行在不在无关）；因此 `scanContents` 那条「缺 blob 必抛」的失败语义只
 * 在冷态成立，热态静默成功（见 `sqlite-vfs-entry.repository.ts` 的
 * scanContents 分支）。生产接受这个取舍：内存层只是把明文的寿命延长到
 * 进程结束，重启即回到冷态、语义复原。
 *
 * ## chat_message 正文已退出本层（2026-09-30 message-plaintext 迭代）
 *
 * 曾经的第二个池（消息正文池，键 = message id）与它的三 API
 * （lookup / remember / forget）随 chat_message 全库明文化一并删除：本迭代
 * 决定新行直写明文，压缩仅剩存量待搬运的形态，聊天侧再不值得为它维持一个
 * 「同 id 换正文必须失效」的不变式（那个义务过去挂在 updateContent / insert
 * / batchInsert / delete 四处写口上，是压缩形态独有的复杂度）。存量压缩行在
 * 反向搬运收敛前重复读退化为每次解压——短窗口代价，换取彻底删掉一层缓存
 * 与四处失效纪律，迁移完成后连 decodeMessageContent 一并退役（V1'）。
 *
 * ## 池的作用域是进程，不是连接/库
 *
 * 池是模块级单例，按**进程**共享，前提是每进程单库单连接（desktop /
 * mobile 现状）。同进程若出现第二个连接或换库，池会继续拿旧库的内容作答，
 * 必须走 `bootstrapNovelMaster` 清池——它已在入口调用
 * {@link clearDecodedContentCaches}（见 bootstrap 模块头的说明）。
 *
 * ## 只存字符串，不存解析结果
 *
 * 池里存的是「解压产物」原样（文件正文），不是 parse 出来的对象：返回值
 * 会被多个消费方共享，存对象就等于把可变引用发到各处，谁改一下缓存就烂
 * 了。JSON.parse 本身远便宜于 inflate。
 *
 * ## 内存上界
 *
 * 双上界（条数 + 字符数）：正文条目体量差异极大（一条几百字节、一个文件
 * 几 MB），只按条数兜不住。超限逐出最旧（Map 迭代序 = 插入序，命中时先删
 * 再插刷新 LRU）。单条超过整个池预算的**不收录**——收录即把别的条目全逐
 * 出去、下次读自己又被逐出，纯抖动。预算必须大于「一次会话的可见工作集」，
 * 否则顺序扫描会把自己逐出去退化成 0 命中。
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
 * 压缩会话的可见文件集同量级；8M 字符足以一次容纳完整工作集，保住
 * 「顺序扫一遍即全部常驻」的命中形态。真要调小，先确认最大工作集
 * ——池小于工作集会退化成 0 命中（见模块头）。
 */
const CONTENT_BODY_POOL_MAX_CHARS = 8_000_000;
const CONTENT_BODY_POOL_MAX_ENTRIES = 1024;

const contentBodyPool = new DecodedContentPool({
  name: "content-body",
  maxEntries: CONTENT_BODY_POOL_MAX_ENTRIES,
  maxChars: CONTENT_BODY_POOL_MAX_CHARS,
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

/** 仅测试与诊断：清空内容正文池（条目与计数器一并归零，保证用例隔离）。 */
export function clearDecodedContentCaches(): void {
  contentBodyPool.clear();
}

/** 内容正文池快照（测试断言命中形态 / 排查内存占用时用）。 */
export function decodedContentCacheStats(): readonly DecodedContentPoolStats[] {
  return [contentBodyPool.stats()];
}
