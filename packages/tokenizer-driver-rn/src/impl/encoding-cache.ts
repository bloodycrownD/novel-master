/**
 * RN 侧 js-tiktoken 编码表取用口——core `encoding-registry` 的**薄包装**
 * （fallback-caliber-align A/B 线）。
 *
 * 为什么要沉到驱动层（而不是留在 app 的 `stream-token-estimator` 里）：
 * - 编码表构造很贵。`new Tiktoken(ranks)` 实测每次 **185–248ms**（要解析整份
 *   ranks 表），而 **js-tiktoken 自身没有任何缓存**——同一进程里建两份表就是
 *   白付两次 200ms+ 的主线程卡顿，还双份吃内存。
 * - 驱动方向是「app 依赖驱动」。反过来让驱动 import app 的私有缓存既违反依赖
 *   方向，tsc 上也不通（`tsconfig.base.json` 无 paths、驱动 `rootDir: ./src`），
 *   所以正确的落点只能在驱动里、app 侧改为 import 本模块。
 * - 本模块**不引入任何 RN 运行时依赖**（只依赖 `js-tiktoken` 与 core 的纯计数
 *   helper / registry），因此可以被 app 的纯逻辑服务直接引用而不必拖进
 *   `react-native` / 原生 bridge。
 *
 * 缓存本体已收敛到 core 的 {@link getEncoding}（`encoding-registry`，键
 * `enc:<encodingName>` 单命名空间），本模块只注入 js-tiktoken 构造、按编码名取用。
 * 缓存策略沿用既有口径：惰性构造（不在模块顶层建表——RN 依赖
 * `fast-text-encoding` polyfill 先执行，顶层构造有环境未就绪风险）、按编码名单例。
 *
 * 失败语义（与旧实现的差别）：构造失败仍缓存 `null`，但由 registry 的
 * **TTL 5 分钟**接管——窗口内不重试，超窗后允许重试（资产恢复 / 环境就绪后有
 * 机会自愈）。旧「失败永不重试」会把一次瞬时故障放大成整个进程寿命的降级，
 * 已废弃。
 *
 * @module tokenizer-driver-rn/impl/encoding-cache
 */
import {
  clearForTests,
  countTextWithIncrementalTokenizer,
  getEncoding,
  setFactoryForTests,
} from "@novel-master/core/provider";
import { Tiktoken } from "js-tiktoken/lite";
import * as cl100kRanksModule from "js-tiktoken/ranks/cl100k_base";
import * as o200kRanksModule from "js-tiktoken/ranks/o200k_base";

/** 本驱动支持的编码名。 */
export type RnEncodingName = "cl100k_base" | "o200k_base";

/**
 * 编码器窄口：只要「文本 → token 数」，不暴露具体实现（便于换表 / 换实现）。
 */
export interface RnTokenEncoding {
  encode(text: string): ArrayLike<unknown>;
}

/**
 * 默认编码名：拿不到模型信息时的兜底表。
 *
 * 非 tiktoken 家族（claude / qwen / glm / gemma…）也用它——这些模型各有自己的
 * tokenizer，js-tiktoken 给不出真值，但**任何真分词器都比字符折算强**
 * （折算对中文低估 82%~84%），近似估算在这里是净收益。
 */
export const DEFAULT_RN_ENCODING_NAME: RnEncodingName = "cl100k_base";

/**
 * ranks 命名空间取默认导出兼容形态。
 *
 * ranks 模块 ESM 侧是 default 导出、CJS 侧是命名导出；Metro / jest(ESM) /
 * jest(CJS) / Vite 四种环境下形态不同，统一经 `(mod.default ?? mod)` 取值。
 */
function unwrapRanksModule(mod: unknown): unknown {
  const candidate = mod as { default?: unknown } | null | undefined;
  return candidate?.default ?? mod;
}

/** js-tiktoken 构造注入：按编码名取对应 ranks 建表。 */
function buildJsTiktokenEncoding(name: RnEncodingName): RnTokenEncoding {
  const ranks =
    name === "o200k_base"
      ? unwrapRanksModule(o200kRanksModule)
      : unwrapRanksModule(cl100kRanksModule);
  return new Tiktoken(ranks as never) as unknown as RnTokenEncoding;
}

/** 取（或惰性构造）指定编码的编码表；构造失败返回 null（TTL 内不重试）。 */
export function getRnEncoding(name: RnEncodingName): RnTokenEncoding | null {
  return getEncoding(name, () => buildJsTiktokenEncoding(name));
}

/** 默认（cl100k）编码表取用口。 */
export function getDefaultRnEncoding(): RnTokenEncoding | null {
  return getRnEncoding(DEFAULT_RN_ENCODING_NAME);
}

/**
 * 用默认编码表（cl100k）计一段文本的 token 数。
 *
 * 走 core 的 `countTextWithIncrementalTokenizer` 而不是直接 `encode`：后者对
 * 「无空白长中文串」是 O(len²)（实测 12K 字符 93s），前者把单次 encode 夹在
 * ≤64 字符、同一段文本耗时与全量 encode 持平或略快（30K 中文 240–250ms vs 266ms），
 * 病态档还快 175~195 倍。
 *
 * @param text 待计数文本。
 * @returns token 数；**编码表不可用时返回 null**，调用方须自行决定降级口径
 *   （不要把 null 当 0）。
 */
export function countTextWithDefaultEncoding(text: string): number | null {
  const encoding = getDefaultRnEncoding();
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
 * 注意这里**不 `free()`**（js-tiktoken 实例本就没有该方法，句柄由 registry 持有）。
 */
export function __resetRnEncodingCacheForTests(): void {
  clearForTests();
}

/**
 * 测试钩子：覆盖编码表构造器（传 `null` 还原默认实现）。
 * 构造器换了，已缓存的表不再由它产出，registry 会一并作废缓存。
 */
export function __setRnEncodingFactoryForTests(
  factory: ((name: RnEncodingName) => RnTokenEncoding) | null,
): void {
  // 适配一层：registry 的工厂槽以「任意编码名字符串」调用，本驱动的注入形态
  // 收窄为 RnEncodingName（实际传入值只会是两表之一）。
  setFactoryForTests(
    factory == null
      ? null
      : (encodingName: string) => factory(encodingName as RnEncodingName),
  );
}
