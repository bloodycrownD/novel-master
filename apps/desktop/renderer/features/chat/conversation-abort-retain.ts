import type {
  AgentRunFinishedPayload,
  AgentStepCommittedPayload,
} from "@novel-master/core/events";
import { shouldApplyTranscriptReload } from "@shared/logic/agent";
import { ipcMessagesAppend } from "@/ipc/client";
import { flushAgentStepUi } from "./flush-run-ui";

export type AbortRetainLifecycle = {
  getUiRunning(): boolean;
  getTranscriptFreezeCount(): number | null;
  getAbortRetainPending(): boolean;
  clearAbortRetainPending(): void;
};

/** Stream delta ingress：Composer 停态后丢弃迟到 delta。 */
export function shouldAcceptStreamIngress(uiRunning: boolean): boolean {
  return uiRunning;
}

export function stepCommittedShouldReload(
  lifecycle: AbortRetainLifecycle,
  phase: AgentStepCommittedPayload["phase"],
): boolean {
  return shouldApplyTranscriptReload(
    lifecycle.getUiRunning(),
    lifecycle.getTranscriptFreezeCount(),
    phase === "assistant"
      ? {
          abortRetainPending: lifecycle.getAbortRetainPending(),
          phase: "assistant",
        }
      : undefined,
  );
}

/**
 * RUN_FINISHED 之后是否要全量 reload 转录。
 *
 * 普通 run 走既有判据（uiRunning + freeze 双保险）。**前奏终态**（`runId === ''`，
 * core 在前奏检查点命中 / 前奏抛错时发的收口事件，r3-run-1 步骤 4）强制 reload。
 *
 * 为什么必须强制：这种 run 一条 delta / step 都没发过，面板上除「已落库的用户
 * 消息」外没有任何可增量更新的东西；而「发送→立刻停止」这一格里
 * abortUiRun 先行（uiRunning=false、freezeCount!=null），既有判据两个条件都不
 * 满足 → 不 reload；abort-retain 的 overlay 兜底又因无半截流式文本而空转。
 * 三者叠加的结果是：用户消息已落库、composer 正文已清空、面板永不刷新 =
 * 消息凭空消失。强制全量 reload 是这里唯一安全且充分的收口。
 */
export function shouldReloadOnRunFinished(
  uiRunning: boolean,
  freezeCount: number | null,
  runId: string,
): boolean {
  return (
    runId === "" || shouldApplyTranscriptReload(uiRunning, freezeCount)
  );
}

export async function commitAbortOverlayFallbackIfNeeded(options: {
  sessionId: string;
  streamingText: string;
  reloadMessages: () => void | Promise<void>;
}): Promise<void> {
  const text = options.streamingText.trim();
  if (text.length === 0) {
    return;
  }
  await ipcMessagesAppend({
    sessionId: options.sessionId,
    role: "assistant",
    text,
  });
  await options.reloadMessages();
}

export function handleStepCommittedAbortRetain(
  payload: AgentStepCommittedPayload,
  lifecycle: AbortRetainLifecycle,
  reloadMessages: () => void | Promise<void>,
  onStreamReset: () => void,
): void {
  if (!stepCommittedShouldReload(lifecycle, payload.phase)) {
    return;
  }
  const abortRetainReload =
    payload.phase === "assistant" && lifecycle.getAbortRetainPending();
  void flushAgentStepUi(
    payload.phase,
    reloadMessages,
    abortRetainReload ? () => undefined : onStreamReset,
  )
    .catch(() => undefined)
    .finally(() => {
      if (abortRetainReload) {
        lifecycle.clearAbortRetainPending();
        onStreamReset();
      }
    });
}

export function handleRunFinishedAbortRetain(
  payload: AgentRunFinishedPayload,
  lifecycle: AbortRetainLifecycle,
  options: {
    finishUiRun: (payload: AgentRunFinishedPayload) => boolean;
    shouldReloadAfterFinish: boolean;
    streamingText: string;
    sessionId: string;
    reloadMessages: () => void | Promise<void>;
    onStreamReset: () => void;
  },
): boolean {
  if (!options.finishUiRun(payload)) {
    return false;
  }
  if (lifecycle.getAbortRetainPending()) {
    void commitAbortOverlayFallbackIfNeeded({
      sessionId: options.sessionId,
      streamingText: options.streamingText,
      reloadMessages: options.reloadMessages,
    })
      .then(() => {
        lifecycle.clearAbortRetainPending();
        options.onStreamReset();
      })
      .catch(() => {
        lifecycle.clearAbortRetainPending();
        options.onStreamReset();
      });
  } else {
    options.onStreamReset();
  }
  if (options.shouldReloadAfterFinish) {
    void options.reloadMessages();
  }
  return true;
}
