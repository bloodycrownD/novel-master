/**
 * 滑窗 token 速率纯函数（双端共用，stream-metrics-tokens）。
 *
 * 输入 (tMs, cumulativeTokens) 采样序列与当前时刻，输出最近时间窗口内的
 * 实时速率（token/秒）。选用时间窗口制而非事件 EWMA：慢速流（5 t/s、
 * delta 稀疏）按事件更新会长时间冻结显示。
 *
 * 语义：
 * - 窗口外样本淘汰（仅参与窗口内首样本的选取前被丢弃）；
 * - 窗口内样本不足两个、或「当前时刻 − 窗口内首样本」时长非正 → null
 *   （调用方省略速率段，避免除零/首秒抖动）；
 * - 分子 = 窗口内末样本与首样本的累计 token 差（末样本即当前累计值，
 *   暂停期不增长）；分母 = 当前时刻 − 窗口内首样本时刻——暂停期分母
 *   持续增长而分子不变，速率自然衰减趋零，恢复后随新样本回升。
 *
 * 组件侧的采样序列维护（token 变化才记样本、heuristic→usage 校正点重
 * seed）由 {@link createTokenRateSampler} 封装，双端共用同一语义。
 *
 * @module domain/format/sliding-token-rate
 */

/** 一次速率采样：时刻（毫秒）与该时刻的累计 token 数。 */
export interface TokenRateSample {
  readonly tMs: number;
  readonly tokens: number;
}

/** 速率滑窗的默认时长（毫秒）。 */
export const SLIDING_TOKEN_RATE_WINDOW_MS = 2_500;

/**
 * 计算滑窗 token 速率（token/秒）；样本不足或时长非正时返回 null。
 *
 * @param samples 按 tMs 升序的采样序列（调用方维护，本函数只读不改）。
 * @param nowMs 当前时刻（毫秒）。
 * @param windowMs 窗口时长（毫秒），缺省 2.5s。
 */
export function slidingTokenRate(
  samples: readonly TokenRateSample[],
  nowMs: number,
  windowMs: number = SLIDING_TOKEN_RATE_WINDOW_MS,
): number | null {
  if (samples.length < 2) {
    return null;
  }
  // 窗口外样本淘汰：只保留窗口内（含边界）的可用段。
  const windowStartMs = nowMs - windowMs;
  let firstIndex = samples.length - 1;
  while (firstIndex > 0 && samples[firstIndex - 1]!.tMs >= windowStartMs) {
    firstIndex -= 1;
  }
  const first = samples[firstIndex]!;
  const last = samples[samples.length - 1]!;
  const elapsedMs = nowMs - first.tMs;
  if (elapsedMs <= 0) {
    return null;
  }
  const tokenDelta = Math.max(0, last.tokens - first.tokens);
  return (tokenDelta * 1_000) / elapsedMs;
}

/** 样本数上限（超长 run 的兜底裁剪；2.5s 窗口 × 250ms 采样 ≈ 10 条在册）。 */
const MAX_RATE_SAMPLES = 512;

/**
 * 采样器（组件渲染节拍驱动的序列维护，双端共用）：
 * - `tokens` 变化才记样本（暂停期不记——分母随 nowMs 增长即衰减趋零）；
 * - `source` 翻转视为 heuristic→usage 校正点：累计值跳变，样本序列清空
 *   重 seed，防一次巨大差分污染速率（校正后窗口从真值重新起算）；翻转前
 *   序列的末值留作 {@link TokenRateSampler.freeze} 的回落值（openai 这类
 *   「真值只在收尾到达」的链路，翻转后往往再没有第二个样本）；
 * - 新 run / 数据源切换由调用方 `reset()`。
 */
export interface TokenRateSampler {
  /** 采样当前累计值并返回窗口速率（token/秒）；样本不足返回 null。 */
  sample(tokens: number, source: string, nowMs: number): number | null;
  /**
   * 只读当前窗口速率（不记样本、不改序列）——供渲染节拍读取：暂停期随
   * nowMs 增长自然衰减，恢复输出后随新样本回升。
   */
  rateAt(nowMs: number): number | null;
  /**
   * 末值快照（run 收尾冻结用）：窗口以**最后一个样本时刻**收尾，不受调用
   * 时刻影响——输出停下后读它仍是「最后一段在稳定输出时的速度」，而不是
   * 被停顿拖低的值。样本不足以成窗口时回落到校正翻转前的末值。
   */
  freeze(): number | null;
  /** 重 seed（新 run / 切会话 / 冻结态退出）。 */
  reset(): void;
}

/** 建一个采样器（持有可变样本序列，组件级单例使用）。 */
export function createTokenRateSampler(): TokenRateSampler {
  let samples: TokenRateSample[] = [];
  let lastTokens: number | null = null;
  let lastSource: string | null = null;
  /** 校正翻转前序列的末值（freeze 的回落值；reset 清空）。 */
  let flippedRate: number | null = null;
  /** 末值：窗口以最后一个样本时刻收尾（停顿不拉低）。 */
  const tailRate = (): number | null => {
    const last = samples[samples.length - 1];
    return last == null ? null : slidingTokenRate(samples, last.tMs);
  };
  return {
    sample(tokens, source, nowMs) {
      if (lastSource !== source) {
        // 校正点（heuristic→usage 覆盖跳变）：先留翻转前末值，再清空重 seed。
        flippedRate = tailRate() ?? flippedRate;
        samples = [{tMs: nowMs, tokens}];
        lastSource = source;
      } else if (lastTokens !== tokens) {
        samples.push({tMs: nowMs, tokens});
        if (samples.length > MAX_RATE_SAMPLES) {
          samples = samples.slice(-MAX_RATE_SAMPLES);
        }
      }
      lastTokens = tokens;
      return slidingTokenRate(samples, nowMs);
    },
    rateAt(nowMs) {
      return slidingTokenRate(samples, nowMs);
    },
    freeze() {
      return tailRate() ?? flippedRate;
    },
    reset() {
      samples = [];
      lastTokens = null;
      lastSource = null;
      flippedRate = null;
    },
  };
}
