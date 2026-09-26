/**
 * 「上次生成」冻结速率的持久化快照（session KKV 值编解码，双端共用）。
 *
 * 语义：run 收尾时把实时速率采样器的**末值快照**（窗口以最后一个样本时刻
 * 收尾，见 `createTokenRateSampler().freeze`）写一次 session KKV，冻结态
 * （「上次生成 · Ns · 输出 M t · R t/s」）在会话内与跨重启水合后读到同一份
 * 数据。属展示派生值——行缺失/损坏一律解析为 null，调用方省略速率段，
 * 不做兜底造数（与 session KKV「丢了不致命」的定位一致）。
 *
 * 加固（可选字段 {@link StreamFinalRateSnapshot.runId}）：快照带上产出它的
 * run 身份，消费方与持久层 settled 行的 runId 比对，不一致按缺值处理——
 * 「上一轮残留值拼到本轮展示」的窗口再收一道。旧格式值（无该字段）照常
 * 解析成功，编解码保持向后兼容。
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
  /**
   * 产出该快照的 run 身份（可选，session KKV 值里的加固字段）。
   *
   * 用途：消费方（mobile 水合）拿它与持久层 settled 行的 runId 比对，
   * 不一致即视为「上一轮的残留值」按缺值处理，避免把旧 run 的速度拼到
   * 新一轮的「上次生成」上。缺字段 = 本字段上线前写入的旧值或 run 身份
   * 未知——**按兼容处理**（不比对、照常采用速率），编解码不因此判坏数据。
   */
  readonly runId?: string;
}

/**
 * 序列化为 KKV 值（紧凑 JSON）。
 *
 * runId 缺省/空串（run 身份未知）时省略该字段——写出的就是旧格式值，
 * 读回侧自然按「无身份可比对」的兼容路径处理。
 */
export function serializeStreamFinalRateSnapshot(
  snapshot: StreamFinalRateSnapshot,
): string {
  return JSON.stringify({
    rate: snapshot.rate,
    tokens: snapshot.tokens,
    atMs: snapshot.atMs,
    ...(snapshot.runId != null && snapshot.runId.length > 0
      ? {runId: snapshot.runId}
      : {}),
  });
}

/**
 * 解析 KKV 值；缺失/损坏/非有限速率一律 null（展示层据此省略速率段）。
 * tokens/atMs 缺字段退化为 0——它们只服务自检，不影响速率段渲染。
 * runId 缺字段/非字符串/空串即省略该键（旧格式值照常解析成功，不判坏数据）。
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
  const {rate, tokens, atMs, runId} = parsed as Partial<
    Record<keyof StreamFinalRateSnapshot, unknown>
  >;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    return null;
  }
  return {
    rate,
    tokens:
      typeof tokens === "number" && Number.isFinite(tokens) ? tokens : 0,
    atMs: typeof atMs === "number" && Number.isFinite(atMs) ? atMs : 0,
    // 只在真拿到非空字符串时带上该键：旧格式值（无 runId）解析出的对象
    // 与加固前逐字段一致，不给消费方多出 `runId: undefined` 的形状差异。
    ...(typeof runId === "string" && runId.length > 0 ? {runId} : {}),
  };
}
