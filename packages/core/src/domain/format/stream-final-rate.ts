/**
 * 「上次生成」冻结速率的持久化快照（session KKV 值编解码，双端共用）。
 *
 * 语义：run 收尾时把实时速率采样器的**末值快照**（窗口以最后一个样本时刻
 * 收尾，见 `createTokenRateSampler().freeze`）写一次 session KKV，冻结态
 * （「上次生成 · Ns · 输出 M t · R t/s」）在会话内与跨重启水合后读到同一份
 * 数据。属展示派生值——行缺失/损坏一律解析为 null，调用方省略速率段，
 * 不做兜底造数（与 session KKV「丢了不致命」的定位一致）。
 *
 * @module domain/format/stream-final-rate
 */

/** 冻结速率快照：速率 + 采样当时的累计输出 token + 采样时刻。 */
export interface StreamFinalRateSnapshot {
  /** 末值速率（token/秒）。 */
  readonly rate: number;
  /** 采样当时的累计输出 token（自检/调试用，不参与展示）。 */
  readonly tokens: number;
  /** 采样时刻（epoch 毫秒）。 */
  readonly atMs: number;
}

/** 序列化为 KKV 值（紧凑 JSON）。 */
export function serializeStreamFinalRateSnapshot(
  snapshot: StreamFinalRateSnapshot,
): string {
  return JSON.stringify({
    rate: snapshot.rate,
    tokens: snapshot.tokens,
    atMs: snapshot.atMs,
  });
}

/**
 * 解析 KKV 值；缺失/损坏/非有限速率一律 null（展示层据此省略速率段）。
 * tokens/atMs 缺字段退化为 0——它们只服务自检，不影响速率段渲染。
 */
export function parseStreamFinalRateSnapshot(
  raw: string | null | undefined,
): StreamFinalRateSnapshot | null {
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
  const {rate, tokens, atMs} = parsed as Partial<StreamFinalRateSnapshot>;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    return null;
  }
  return {
    rate,
    tokens:
      typeof tokens === "number" && Number.isFinite(tokens) ? tokens : 0,
    atMs: typeof atMs === "number" && Number.isFinite(atMs) ? atMs : 0,
  };
}
