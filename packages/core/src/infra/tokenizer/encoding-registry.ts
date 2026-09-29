/**
 * 编码表注册中心（fallback-caliber-align A 线）——零分词器运行时依赖的
 * 「容器 + 键规范 + 生命周期」模块。
 *
 * 背景：desktop main（WASM tiktoken）、desktop renderer（js-tiktoken）、
 * RN（js-tiktoken）曾各自维护编码表单例缓存，语义各异。本模块把「按编码名取
 * 单例表」的唯一实现收进 core，构造器由各端注入（node 注入 WASM tiktoken
 * 构造、RN/renderer 注入 js-tiktoken 构造），core 自身不 import 任何分词器包。
 * 物理边界：跨进程不共享实例，收敛目标是「每进程内单一实例 + 三端共用同一段
 * 实现代码」。
 *
 * 键规范：单命名空间 `enc:<encodingName>`。历史上 node 驱动还有过
 * `model:<modelName>` 双键（同一张表因按模型名与按编码名各取一次而构造两份），
 * 已废除——model→encoding 的解析上移到驱动调用方，registry 只认编码名，
 * `getEncoding(name, build)` 的 `name` 传编码名（如 `cl100k_base`）即可，
 * `enc:` 前缀由本模块统一拼装，调用方不要再自己拼。
 *
 * free 生命周期（重要不变量）：registry 吐出的是**共享句柄**——精确档、兜底档、
 * 预热方都持有同一张表，任何一方调用 `free()`（WASM 侧释放底层 ranks）都会让
 * 其它持有者拿到已释放的句柄、后续 `encode` 直接炸。所以：**句柄由 registry
 * 持有、进程内一直活着、绝不 `free()`**；{@link clearForTests} 也只丢弃引用
 * 不释放，WASM 内存随进程退出整体回收（表以编码名为界，是有上界的小集合，
 * 不存在无界增长）。
 *
 * 失败语义：构造失败缓存 `null` 并记 `failedAt`，TTL（默认 5 分钟，见
 * {@link ENCODING_RETRY_TTL_MS}）内的后续取用**不重试**、直接返回 `null`；
 * 超过 TTL 后的下一次取用允许重试。与旧驱动缓存「失败永不重试」不同——那会把
 * 一次瞬时故障（如资产暂时缺失）放大成整个进程寿命的降级；5 分钟窗口足以挡住
 * 同一请求内的反复白烧，又给热修/更新留出恢复机会。重试再失败则以重试时刻
 * 重起 TTL 窗口。
 *
 * 计数口径提醒：registry 只管表的生命周期，不管怎么数——对「无空白长中文串」
 * 直接 `encode` 是 O(len²) 病态，分块保护由调用方（core 的
 * `countTextWithIncrementalTokenizer` 或 message-token-cache 落地的统一包装）
 * 负责。
 *
 * @module infra/tokenizer/encoding-registry
 */

/**
 * registry 句柄的最小结构契约：只要能把文本 encode 成带 `length` 的序列。
 * WASM tiktoken 的 `Tiktoken` 与 js-tiktoken 的 `Tiktoken` 都结构兼容，
 * 泛型参数让各端拿回自己的具体类型。
 */
export interface EncodingHandle {
  encode(text: string): { readonly length: number };
}

/** 编码表构造器：入参为编码名，返回可共享的句柄；抛错视为构造失败。 */
export type EncodingFactory<T extends EncodingHandle = EncodingHandle> = (
  encodingName: string,
) => T;

/** 失败缓存的重试 TTL（毫秒）：5 分钟内的重复取用不触发重建。 */
export const ENCODING_RETRY_TTL_MS = 5 * 60 * 1000;

interface RegistryEntry {
  /** 单例句柄；`null` = 上次构造失败（看 `failedAt` 判断是否允许重试）。 */
  readonly encoding: EncodingHandle | null;
  /** 失败时刻（仅 `encoding === null` 时有意义）。 */
  readonly failedAt: number | null;
}

/** 编码表缓存：键为 `enc:<encodingName>`。 */
const encodingByKey = new Map<string, RegistryEntry>();

/**
 * 构造器覆盖钩子（仅测试用）：`null` = 调用方注入真实构造。
 * 设成抛错的函数即可复现「编码表建不起来」这条降级路径。
 */
let encodingFactory: EncodingFactory | null = null;

/** 时钟（仅测试可通过 {@link setClockForTests} 替换为假时钟）。 */
let clock: () => number = () => Date.now();

function toKey(encodingName: string): string {
  return `enc:${encodingName}`;
}

/**
 * 按**编码名**取（单例）编码表；构造失败返回 `null`（TTL 内不重试）。
 *
 * `build` 由调用方注入（各端各自的分词器构造方式）；缓存命中时 `build` 不会被
 * 调用。返回的是**共享句柄**，调用方不得 `free()`（见模块头注释）。
 */
export function getEncoding<T extends EncodingHandle>(
  encodingName: string,
  build: () => T,
): T | null {
  const key = toKey(encodingName);
  const cached = encodingByKey.get(key);
  if (cached !== undefined) {
    if (cached.encoding !== null) {
      return cached.encoding as T;
    }
    // 失败缓存：TTL 未满继续返回 null，不重试。
    if (
      cached.failedAt != null &&
      clock() - cached.failedAt < ENCODING_RETRY_TTL_MS
    ) {
      return null;
    }
    // 超过 TTL：丢弃失败记录，允许重试。
    encodingByKey.delete(key);
  }

  let encoding: T | null = null;
  let failedAt: number | null = null;
  try {
    encoding = (encodingFactory ? encodingFactory(encodingName) : build()) as T;
  } catch (err) {
    console.warn(
      `[novel-master/core/tokenizer-registry] tiktoken encoding init failed (${key})`,
      err,
    );
    encoding = null;
    failedAt = clock();
  }
  encodingByKey.set(key, { encoding, failedAt });
  return encoding;
}

/**
 * 测试钩子：只清空编码表缓存（不动构造器与时钟）。
 *
 * 刻意与 {@link setFactoryForTests} 分开：后者已经会顺带作废缓存，若这里再顺手
 * 把构造器也还原，「先注入故障构造器、再清缓存」这种最自然的测试写法就会被
 * 悄悄 undo，故两个钩子各管一件事。
 *
 * 注意这里**不 `free()`**（见模块头「free 生命周期」）。
 */
export function clearForTests(): void {
  encodingByKey.clear();
}

/**
 * 测试钩子：覆盖编码表构造器（传 `null` 还原为调用方注入的 `build`）。
 * 构造器换了，已缓存的表不再由它产出，必须一并作废。
 */
export function setFactoryForTests<T extends EncodingHandle>(
  factory: EncodingFactory<T> | null,
): void {
  encodingFactory = factory as EncodingFactory | null;
  encodingByKey.clear();
}

/**
 * 测试钩子：替换 TTL 判定用的时钟（传 `null` 还原 `Date.now`）。
 * 仅供需要快进失败重试窗口的用例使用，生产代码不应触碰。
 */
export function setClockForTests(now: (() => number) | null): void {
  clock = now ?? (() => Date.now());
}
