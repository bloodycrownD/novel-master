/**
 * 滑窗 token 速率纯函数（双端共用，stream-metrics-tokens）。
 *
 * 输入 (tMs, cumulativeTokens) 采样序列与当前时刻，输出最近时间窗口内的
 * 实时速率（token/秒）。选用时间窗口制而非事件 EWMA：慢速流（5 t/s、
 * delta 稀疏）按事件更新会长时间冻结显示。
 *
 * 语义：
 * - 窗口外样本淘汰（仅参与窗口内首样本的选取前被丢弃）；
 * - 未来样本（`tMs > nowMs`，时钟回拨/校正跳变残留）一律不参与窗口，
 *   全部样本都在未来时与「样本不足」同解 → null；
 * - 窗口内样本不足两个、或「当前时刻 − 窗口内首样本」时长非正 → null
 *   （调用方省略速率段，避免除零/首秒抖动）；
 * - 分子 = 窗口内末样本与首样本的累计 token 差（末样本即当前累计值，
 *   暂停期不增长）；分母 = 当前时刻 − 窗口内首样本时刻——暂停期分母
 *   持续增长而分子不变，速率自然衰减趋零，恢复后随新样本回升。
 *
 * 组件侧的采样序列维护（token 变化才记样本、同刻去重、时钟回拨丢弃、
 * 校正点重 seed）由 {@link createTokenRateSampler} 封装，双端共用同一语义。
 *
 * @module domain/format/sliding-token-rate
 */

import type {StreamTokenSource} from "../session-run-state/model/session-run-state.js";

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
 * 序列按 tMs 升序（采样器保证）；未来样本（`tMs > nowMs`）不参与窗口，
 * 末样本取「不晚于 nowMs 的最近一条」——全部样本都在未来时与「样本不足」
 * 同解（null）。
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
  // 末样本 = 不晚于 nowMs 的最近一条：时钟回拨/跳变留下的未来样本不参与
  // 窗口（全未来样本 → lastIndex < 1 → null，与「样本不足」同解）。
  let lastIndex = samples.length - 1;
  while (lastIndex >= 0 && samples[lastIndex]!.tMs > nowMs) {
    lastIndex -= 1;
  }
  if (lastIndex < 1) {
    return null;
  }
  // 窗口外样本淘汰：只保留窗口内（含边界）的可用段；候选样本仍须不晚于
  // nowMs（无序残留的未来样本到此为止，窗口内样本恒 ≤ nowMs）。
  const windowStartMs = nowMs - windowMs;
  let firstIndex = lastIndex;
  while (
    firstIndex > 0 &&
    samples[firstIndex - 1]!.tMs >= windowStartMs &&
    samples[firstIndex - 1]!.tMs <= nowMs
  ) {
    firstIndex -= 1;
  }
  const first = samples[firstIndex]!;
  const last = samples[lastIndex]!;
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
 * - 同一毫秒内的多条样本**就地替换**（只留最终累计值），不新增样本——否则
 *   窗口首=末同刻，整批增量 ÷ 几毫秒 → 瞬时可读速率爆表；
 * - 时钟回拨（nowMs 早于末样本）的样本**入口丢弃**，序列恒按 tMs 升序；
 *   累计值不丢——时钟恢复后第一个样本会带上这段增量；
 * - **校正点重 seed** 覆盖两种情形：
 *   1) `source` 翻转（heuristic→usage）：累计值尺度跳变，序列清空重 seed，
 *      防一次巨大差分污染速率；翻转前序列的末值留作
 *      {@link TokenRateSampler.freeze} 的回落值（openai 这类「真值只在收尾
 *      到达」的链路，翻转后往往再没有第二个样本）；
 *   2) **窗口折叠后的首个新样本**：与上一个样本相隔 ≥ 窗口时长时，旧样本
 *      再也不会进任何未来窗口（`窗口起点 > 旧样本时刻`），等价于已折叠；
 *      此时先把当前窗口末值刷进回落值再清空重 seed——多步 run 跨 step
 *      静默后，`freeze()` 因此能给出「最后一段稳定输出的速率」，而不是
 *      null 或第一步的陈速率。
 *      不采用「每次 usage 事件都清窗」的更激进口径：gemini 每个候选块都
 *      emit 一条 usage（累计值变化才发），逐条清窗会把实时速率反复清成
 *      null（速率段闪没），是回归。
 * - 新 run / 数据源切换由调用方 `reset()`。
 */
export interface TokenRateSampler {
  /** 采样当前累计值并返回窗口速率（token/秒）；样本不足返回 null。 */
  sample(
    tokens: number,
    source: StreamTokenSource,
    nowMs: number,
  ): number | null;
  /**
   * 只读当前窗口速率（不记样本、不改序列）——供渲染节拍读取：暂停期随
   * nowMs 增长自然衰减，恢复输出后随新样本回升。
   */
  rateAt(nowMs: number): number | null;
  /**
   * 末值快照（run 收尾冻结用）：窗口以**最后一个样本时刻**收尾，不受调用
   * 时刻影响——输出停下后读它仍是「最后一段在稳定输出时的速度」，而不是
   * 被停顿拖低的值。样本不足以成窗口时回落到上一个稳定窗口的末值（校正点
   * 重 seed 前的末值，含 source 翻转与窗口折叠两种校正点）。
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
  /** 末样本时刻（同刻去重与时钟回拨判定用；reset 清回 −∞）。 */
  let lastSampleMs = Number.NEGATIVE_INFINITY;
  /**
   * 上一个稳定窗口的末值 = `freeze()` 的回落值（样本不足以成窗口时用）。
   * 写入点即校正点（source 翻转 / 窗口折叠）；reset 清空。
   */
  let lastSettledRate: number | null = null;
  /** 末值：窗口以最后一个样本时刻收尾（停顿不拉低）。 */
  const tailRate = (): number | null => {
    const last = samples[samples.length - 1];
    return last == null ? null : slidingTokenRate(samples, last.tMs);
  };
  return {
    sample(tokens, source, nowMs) {
      if (lastSource !== source) {
        // 校正点（heuristic→usage 覆盖跳变）：先留翻转前末值，再清空重 seed。
        lastSettledRate = tailRate() ?? lastSettledRate;
        samples = [{tMs: nowMs, tokens}];
        lastSampleMs = nowMs;
        lastSource = source;
      } else if (lastTokens !== tokens) {
        if (nowMs > lastSampleMs) {
          if (nowMs - lastSampleMs >= SLIDING_TOKEN_RATE_WINDOW_MS) {
            // 窗口折叠：与上个样本相隔 ≥ 窗口时长，旧样本再也不会进任何未来
            // 窗口（多步 run 的 step 间静默即此形态）。先把当前窗口末值刷进
            // 回落值，再清空重 seed——freeze() 才能给出最后一段稳定速率。
            lastSettledRate = tailRate() ?? lastSettledRate;
            samples = [];
          }
          samples.push({tMs: nowMs, tokens});
          lastSampleMs = nowMs;
          if (samples.length > MAX_RATE_SAMPLES) {
            samples = samples.slice(-MAX_RATE_SAMPLES);
          }
        } else if (nowMs === lastSampleMs) {
          // 同刻去重：同一毫秒内的多条 delta 只留最终累计值，不 push。
          samples[samples.length - 1] = {tMs: nowMs, tokens};
        }
        // nowMs < lastSampleMs：时钟回拨，入口丢弃——不记样本，保序列升序。
      }
      lastTokens = tokens;
      return slidingTokenRate(samples, nowMs);
    },
    rateAt(nowMs) {
      return slidingTokenRate(samples, nowMs);
    },
    freeze() {
      return tailRate() ?? lastSettledRate;
    },
    reset() {
      samples = [];
      lastTokens = null;
      lastSource = null;
      lastSampleMs = Number.NEGATIVE_INFINITY;
      lastSettledRate = null;
    },
  };
}
