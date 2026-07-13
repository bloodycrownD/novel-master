import type {
  AgentRunFinishedPayload,
  AgentStepCommittedPayload,
} from "@shared/agent-event-types";
import { shouldApplyTranscriptReload } from "@novel-master/core/agent";
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
  void flushAgentStepUi(payload.phase, reloadMessages, () => {
    if (payload.phase === "assistant") {
      lifecycle.clearAbortRetainPending();
    }
    onStreamReset();
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
