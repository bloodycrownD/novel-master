/**
 * 流式指标按会话归属存储（模块级单例）。
 *
 * 为什么不是 provider 里的单例累加器：旧实现把累加器绑在「当前展示的会话」
 * 上，切会话只靠 running 翻转碰运气重置（React 批处理还常把翻转塌掉），
 * 导致两个真机症状：统计条串到别的会话的字数；重进运行中会话从零计时。
 *
 * 正确语义（用户拍板）：
 * - 新 run 开始（该会话发新消息/恢复运行）→ 重置该会话的指标；
 * - 终止/结束 → 冻结为该会话的「上次生成」，不清零别的会话；
 * - 切会话/重进 → 只换看哪份，不重置。重进运行中会话显示真实历时
 *   （startedAtMs 是 run 开始时刻，连续累计）。
 *
 * 归账不依赖当前绑定：总线事件里带 sessionId/runId，无论 UI 正在看哪个
 * 会话，增量都记到属主会话头上。
 */

export type SessionStreamMetricsAcc = {
  textChars: number;
  thinkingChars: number;
  startedAtMs: number;
  runId: string | null;
};

export type SessionStreamMetricsSnapshot = {
  elapsedMs: number;
  textChars: number;
  thinkingChars: number;
};

type LiveEntry = SessionStreamMetricsAcc;

const liveEntries = new Map<string, LiveEntry>();
const lastRunEntries = new Map<string, SessionStreamMetricsSnapshot>();

function ensureEntry(sessionId: string): LiveEntry {
  let entry = liveEntries.get(sessionId);
  if (entry == null) {
    entry = {textChars: 0, thinkingChars: 0, startedAtMs: 0, runId: null};
    liveEntries.set(sessionId, entry);
  }
  return entry;
}

/** 新 run 开始：重置该会话的 live 指标。同一 runId 的重复 STARTED（回填）不重置。 */
export function noteRunStarted(sessionId: string, runId: string): void {
  const entry = ensureEntry(sessionId);
  if (entry.startedAtMs > 0 && entry.runId === runId) {
    return;
  }
  liveEntries.set(sessionId, {
    textChars: 0,
    thinkingChars: 0,
    startedAtMs: Date.now(),
    runId,
  });
}

/** 文本增量归账。runId 与当前 live run 不符（陈旧事件）忽略。 */
export function noteTextDelta(
  sessionId: string,
  runId: string,
  length: number,
): void {
  if (length <= 0) {
    return;
  }
  const entry = liveEntries.get(sessionId);
  if (entry == null || entry.runId !== runId) {
    return;
  }
  entry.textChars += length;
}

/** 思考增量归账。规则同 noteTextDelta。 */
export function noteThinkingDelta(
  sessionId: string,
  runId: string,
  length: number,
): void {
  if (length <= 0) {
    return;
  }
  const entry = liveEntries.get(sessionId);
  if (entry == null || entry.runId !== runId) {
    return;
  }
  entry.thinkingChars += length;
}

/** run 结束：live 冻结为该会话的「上次生成」。runId 不符时不动（保护新 run）。 */
export function finishRun(sessionId: string, runId: string): void {
  const entry = liveEntries.get(sessionId);
  if (entry == null || entry.runId !== runId) {
    return;
  }
  lastRunEntries.set(sessionId, {
    elapsedMs: Math.max(0, Date.now() - entry.startedAtMs),
    textChars: entry.textChars,
    thinkingChars: entry.thinkingChars,
  });
  liveEntries.set(sessionId, {
    textChars: 0,
    thinkingChars: 0,
    startedAtMs: 0,
    runId: null,
  });
}

/** 当前 run 的 live 累计（无活跃 run 时 startedAtMs 为 0）。 */
export function getLiveMetrics(sessionId: string): SessionStreamMetricsAcc {
  return (
    liveEntries.get(sessionId) ?? {
      textChars: 0,
      thinkingChars: 0,
      startedAtMs: 0,
      runId: null,
    }
  );
}

/** 该会话上一次 run 的快照（无则 null）。 */
export function getLastRunMetrics(
  sessionId: string,
): SessionStreamMetricsSnapshot | null {
  return lastRunEntries.get(sessionId) ?? null;
}

/** 测试隔离用。 */
export function __resetStreamMetricsStoreForTests(): void {
  liveEntries.clear();
  lastRunEntries.clear();
}
