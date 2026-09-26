/**
 * desktop renderer 的实时 token 估算器绑定（stream-metrics-native ②）。
 *
 * - 编码表：v1 **固定 cl100k_base**——renderer 是纯 web（sandbox/
 *   contextIsolation），js-tiktoken 纯 JS 可直接用；按会话模型解析
 *   o200k/cl100k 需要读会话/模型仓储（异步、且 renderer 侧暂无 IPC 面），
 *   留给后续迭代。o200k 模型（gpt-4o/o1/o3/gpt-5）用 cl100k 估算的偏差是
 *   有界的既有近似（Chinese 端约 ±10% 量级），且 usage 真值到达即重锚基线，
 *   误差不累积。
 * - 编码表惰性构造 + 模块级缓存：每张编码表构造要解析全量 ranks（实测
 *   cl100k 约 180–250ms、o200k 约 420ms），不能每次 run 重建；
 *   构造失败（缺 ranks / 环境异常）缓存为 null，调用方回退启发式。
 *
 * @module renderer/hooks/stream-token-estimator
 */
import {
  createIncrementalTokenCounter,
  type IncrementalTokenCounter,
} from "@shared/logic/format";
import { Tiktoken } from "js-tiktoken/lite";
import cl100kRanks from "js-tiktoken/ranks/cl100k_base";

/** 编码器窄口（只要 encode 的字符数）。 */
type TiktokenEncoding = {
  encode(text: string): number[] | Uint32Array;
};

/** undefined = 尚未尝试构造；null = 构造失败。 */
let cl100kEncoding: TiktokenEncoding | null | undefined;

/** cl100k_base 编码表单例（惰性构造；失败缓存 null）。 */
function getCl100kEncoding(): TiktokenEncoding | null {
  if (cl100kEncoding !== undefined) {
    return cl100kEncoding;
  }
  try {
    cl100kEncoding = new Tiktoken(cl100kRanks) as unknown as TiktokenEncoding;
  } catch (err) {
    console.warn(
      "[novel-master/desktop] js-tiktoken init failed, fallback to heuristic",
      err,
    );
    cl100kEncoding = null;
  }
  return cl100kEncoding;
}

/**
 * 建一条实时 token 估算器（尾窗增量计数）；编码表不可用时返回 null，
 * 调用方（`useAgentStreamMetrics`）回退启发式。
 */
export function createDesktopStreamTokenEstimator(): IncrementalTokenCounter | null {
  const encoding = getCl100kEncoding();
  if (encoding == null) {
    return null;
  }
  return createIncrementalTokenCounter({
    encode: text => encoding.encode(text).length,
  });
}
