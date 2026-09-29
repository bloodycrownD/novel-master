/**
 * Node 侧 tiktoken 编码表取用口——core `encoding-registry` 的**薄包装**
 * （fallback-caliber-align A/B 线）。
 *
 * 为什么必须有这层缓存语义：兜底计数从 `ceil(字符数 / 3.35)` 换成真分词器后，
 * 每次兜底都要拿到一张编码表。而 `tiktoken`（WASM）的 `encoding_for_model` /
 * `get_encoding` **每次调用都新建一整张 BPE 表**，`free()` 才释放——原实现在
 * `count-prompt-llm-input.ts` 里就是「用完立刻 `free()`」，等价于每次计数都重建
 * 一张几十 MB 的 ranks 表再扔掉。在「每次刷新 meta bar 都要重算」的路径上，这是
 * 白付的 CPU + GC。
 *
 * 缓存本体已收敛到 core 的 {@link getEncoding}（`encoding-registry`），本模块只做
 * 三件事：注入 WASM 构造（`get_encoding`）、保留既有导出签名（消费方零改动）、
 * 维持 Node 侧的默认表与计数口径。历史上本模块自建的 `model:` / `enc:` 双命名
 * 空间已随收敛废除——同一张表曾因「按模型名取一次、按编码名取一次」构造两份，
 * 现在 registry 只认 `enc:<encodingName>` 单键空间，model→encoding 的解析上移到
 * {@link getNodeEncodingForModel} 内部（走 tiktoken 官方映射
 * `get_encoding_name_for_model`），精确档与兜底档从此共享同一张表。
 *
 * `free()` 生命周期不变量：registry 吐出的是**共享句柄**——精确档、兜底档、预热
 * 方持有同一张表，任何一方 `free()` 都会让其它持有者拿到已释放的 WASM 句柄、后续
 * `encode` 直接炸。所以句柄由 registry 持有、进程内一直活着、绝不 `free()`；
 * {@link clearNodeEncodingCacheForTests} 也只丢弃引用不释放，WASM 内存随进程退出
 * 整体回收（表以编码名为界，是有上界的小集合，不存在无界增长）。
 *
 * 失败语义（与旧实现的差别）：构造失败仍缓存 `null`，但由 registry 的
 * **TTL 5 分钟**接管——窗口内不重试（挡住同一请求内的反复白烧），超窗后允许重试
 * （给热修 / 资产恢复留出口）。旧「失败永不重试」会把一次瞬时故障放大成整个进程
 * 寿命的降级，已废弃。
 *
 * 计数一律走 core 的 {@link countTextWithIncrementalTokenizer} 而不是直接
 * `encode`：后者对「无空白长中文串」是 O(len²)（实测 12K 字符约 88s），前者把
 * 单次 encode 夹在 ≤64 字符、正常文本上与全量 encode 打平，病态档还快两个数量级。
 *
 * @module tokenizer-driver-node/impl/encoding-cache
 */

import {
  clearForTests,
  countTextWithIncrementalTokenizer,
  getEncoding,
  setFactoryForTests,
} from "@novel-master/core/provider";
import {
  get_encoding,
  get_encoding_name_for_model,
  type Tiktoken,
  type TiktokenEncoding,
  type TiktokenModel,
} from "tiktoken";

/**
 * 默认编码名：拿不到模型信息（或模型名不被 tiktoken 认识）时的兜底表。
 *
 * 非 tiktoken 家族（claude / qwen / glm / gemma…）也用它——这些模型各有自己的
 * tokenizer，tiktoken 给不出真值，但**任何真分词器都比字符折算强**（折算对中文
 * 正文低估 82%~84%），近似估算在这里是净收益。正因为只是近似，调用方必须继续
 * 报 `counterKind: "heuristic"`。
 */
export const DEFAULT_NODE_ENCODING_NAME: TiktokenEncoding = "cl100k_base";

/**
 * 测试钩子的构造器形态：入参为**编码名**（如 `cl100k_base`，不带 `enc:` 前缀），
 * 抛错视为构造失败。`model:` 键废除后这里不再出现模型名形态的键。
 */
export type NodeEncodingFactory = (encodingName: string) => Tiktoken;

/**
 * WASM 构造注入：按编码名建整张表。
 *
 * `Tiktoken` 结构上满足 registry 的 `EncodingHandle` 契约（`encode` 返回带
 * `length` 的序列），无需适配层。
 */
function buildWasmEncoding(encodingName: string): Tiktoken {
  return get_encoding(encodingName as TiktokenEncoding);
}

/**
 * 按**模型名**取（单例）编码表；模型名不被 tiktoken 认识时返回 `null`。
 *
 * 精确档（`counterKind: "tiktoken"`）走这里。`model:` 键废除后的取法：先用
 * tiktoken 官方映射 `get_encoding_name_for_model` 把模型名解析成编码名
 * （gpt-4o → o200k_base、gpt-4 / gpt-3.5-turbo → cl100k_base……），再进
 * registry 的 `enc:` 单键空间——因此与 {@link getNodeEncodingByName} 取同一张表。
 * 模型名解析失败（不被认识）在进 registry 前就返回 `null`：解析只是查一张
 * 静态映射表、零建表开销，不值得为它占 TTL 失败缓存。
 *
 * 取到的是**共享单例**，调用方不得 `free()`。
 */
export function getNodeEncodingForModel(
  tiktokenModel: TiktokenModel | string,
): Tiktoken | null {
  let encodingName: TiktokenEncoding;
  try {
    encodingName = get_encoding_name_for_model(tiktokenModel as TiktokenModel);
  } catch (err) {
    console.warn(
      `[novel-master/tokenizer-driver-node] tiktoken model not recognized (${tiktokenModel})`,
      err,
    );
    return null;
  }
  return getEncoding(encodingName, () => buildWasmEncoding(encodingName));
}

/** 按**编码名**取（单例）编码表；失败返回 `null`（TTL 内不重试，见模块头注释）。 */
export function getNodeEncodingByName(
  name: TiktokenEncoding | string,
): Tiktoken | null {
  return getEncoding(name, () => buildWasmEncoding(name));
}

/** 默认（cl100k）编码表取用口。 */
export function getDefaultNodeEncoding(): Tiktoken | null {
  return getNodeEncodingByName(DEFAULT_NODE_ENCODING_NAME);
}

/**
 * 用默认编码表（cl100k）计一段文本的 token 数。
 *
 * @param text 待计数文本。
 * @returns token 数（估算值，误差实测 ≤0.6%）；**编码表不可用时返回 `null`**，
 *   调用方须自行决定降级口径（不要把 `null` 当 0）。
 */
export function countTextWithDefaultEncoding(text: string): number | null {
  const encoding = getDefaultNodeEncoding();
  if (encoding == null) {
    return null;
  }
  return countTextWithIncrementalTokenizer(
    (chunk) => encoding.encode(chunk).length,
    text,
  );
}

/**
 * 测试钩子：只清空编码表缓存（不动构造器）。转发 registry 的同名钩子。
 *
 * 注意这里**不 `free()`**（见模块头「free 生命周期」）。
 */
export function clearNodeEncodingCacheForTests(): void {
  clearForTests();
}

/**
 * 测试钩子：覆盖编码表构造器（传 `null` 还原真实实现）。
 * 构造器换了，已缓存的表不再由它产出，registry 会一并作废缓存。
 */
export function __setNodeEncodingFactoryForTests(
  factory: NodeEncodingFactory | null,
): void {
  setFactoryForTests(factory);
}
