/**
 * Stream 单元（事件源底座）—— Phase 3 Step 20。
 *
 * 订阅 main 进程转发过来的 agent stream 事件，自己持有 streamingText /
 * streamingThinking 状态与 streamingTextRef，把 ConversationPanel 内联的
 * stream state + onTextDelta / onThinkingDelta 收口进单元内部。
 *
 * 生命周期事件（RUN_STARTED / STEP_COMMITTED / RUN_FINISHED / RUN_FAILED）
 * 仍走回调上抛，让消费方处理 reload / abort-retain / vfs 突变等业务逻辑。
 *
 * 回调集合经 **ref** 传入（不是直接传值），这样消费方可以先调本 hook、拿到
 * streamingTextRef / onStreamReset 后再去定义那些回调，避免前后向声明耦合
 * （与 Mobile P1-2 装配形态对称）。hook 内部把 ref.current 在每次事件到达
 * 时现读，渲染期消费方把最新回调塞进 ref.current 即可。
 *
 * delta 入口默认直写 state；batchEnabled=true 时改为先入 batch 缓冲
 * （Phase 3 Step 21，renderer 层 RAF 合并），由 batch 在 flush 时回写 state。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  type AgentRunFailedPayload,
  type AgentRunFinishedPayload,
  type AgentRunStartedPayload,
  type AgentStepCommittedPayload,
  type AgentStreamTextDeltaPayload,
  type AgentStreamThinkingDeltaPayload,
  type AgentStreamToolUsePayload,
} from "@novel-master/core/events";
import { onAgentStream } from "../ipc/client";
import { useConversationBatch } from "@/features/chat/conversation-batch";

export interface UseAgentStreamCallbacks {
  /** runId 不匹配则丢弃；匹配则通过 */
  acceptRunEvent(runId: string | undefined): boolean;
  /** delta 入口守卫：uiRunning=false 时丢弃迟到的 delta。 */
  getUiRunning(): boolean;
  /** 可选 metrics 旁路（无论是否走 batch 都会触发）。 */
  noteTextDelta?(delta: string): void;
  noteThinkingDelta?(delta: string): void;
  onRunStarted?(payload: AgentRunStartedPayload): void;
  onStepCommitted?(payload: AgentStepCommittedPayload): void;
  onRunFinished?(payload: AgentRunFinishedPayload): void;
  onRunFailed?(payload: AgentRunFailedPayload): void;
}

export interface UseAgentStreamOptions {
  readonly sessionId: string | undefined;
  /**
   * 回调集合 ref。消费方在调本 hook 后定义回调，再写入 ref.current；
   * 本 hook 在事件到达时现读 ref.current，所以不依赖回调的定义顺序。
   */
  readonly callbacksRef: MutableRefObject<UseAgentStreamCallbacks>;
  readonly batchEnabled?: boolean;
}

export interface UseAgentStreamResult {
  readonly streamingText: string;
  readonly streamingThinking: string;
  readonly streamingTextRef: MutableRefObject<string>;
  /** 清掉半成品 stream 文本（abort / commit / 切会话用）。 */
  readonly onStreamReset: () => void;
}

export function useAgentStream(
  options: UseAgentStreamOptions,
): UseAgentStreamResult {
  const { sessionId, callbacksRef, batchEnabled } = options;

  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const streamingTextRef = useRef("");

  const applyTextDelta = useCallback((delta: string) => {
    if (delta.length === 0) return;
    setStreamingText((prev) => {
      const next = prev + delta;
      streamingTextRef.current = next;
      return next;
    });
  }, []);

  const applyThinkingDelta = useCallback((delta: string) => {
    if (delta.length === 0) return;
    setStreamingThinking((prev) => prev + delta);
  }, []);

  // Phase 3 Step 21：renderer 层 RAF batch。enabled=true 时 text/thinking
  // delta 先入 buffer，由下一帧 flush 回写 state；enabled=false 时退化为直通。
  const batchSink = useConversationBatch({
    enabled: batchEnabled === true,
    onTextFlush: applyTextDelta,
    onThinkingFlush: applyThinkingDelta,
  });
  const batchSinkRef = useRef(batchSink);
  batchSinkRef.current = batchSink;

  const onStreamReset = useCallback(() => {
    streamingTextRef.current = "";
    setStreamingText("");
    setStreamingThinking("");
    batchSinkRef.current.reset();
  }, []);

  const batchEnabledRef = useRef(batchEnabled);
  batchEnabledRef.current = batchEnabled;

  useEffect(() => {
    if (sessionId == null) {
      return;
    }
    return onAgentStream((envelope) => {
      const { type, payload } = envelope;
      const cb = callbacksRef.current;
      const useBatch = batchEnabledRef.current === true;
      if (type === EVENT_AGENT_RUN_STARTED) {
        const p = payload as AgentRunStartedPayload;
        if (p.sessionId === sessionId) {
          cb.onRunStarted?.(p);
        }
        return;
      }
      if (type === EVENT_AGENT_STREAM_TEXT_DELTA) {
        const p = payload as AgentStreamTextDeltaPayload;
        if (p.sessionId !== sessionId || !cb.acceptRunEvent(p.runId)) {
          return;
        }
        if (!cb.getUiRunning()) {
          return;
        }
        cb.noteTextDelta?.(p.text);
        if (useBatch) {
          batchSinkRef.current.pushTextDelta(p.text);
        } else {
          applyTextDelta(p.text);
        }
        return;
      }
      if (type === EVENT_AGENT_STREAM_THINKING_DELTA) {
        const p = payload as AgentStreamThinkingDeltaPayload;
        if (p.sessionId !== sessionId || !cb.acceptRunEvent(p.runId)) {
          return;
        }
        if (!cb.getUiRunning()) {
          return;
        }
        cb.noteThinkingDelta?.(p.text);
        if (useBatch) {
          batchSinkRef.current.pushThinkingDelta(p.text);
        } else {
          applyThinkingDelta(p.text);
        }
        return;
      }
      if (type === EVENT_AGENT_STREAM_TOOL_USE) {
        const p = payload as AgentStreamToolUsePayload;
        if (p.sessionId !== sessionId || !cb.acceptRunEvent(p.runId)) {
          return;
        }
        return;
      }
      if (type === EVENT_AGENT_STEP_COMMITTED) {
        const p = payload as AgentStepCommittedPayload;
        if (p.sessionId !== sessionId || !cb.acceptRunEvent(p.runId)) {
          return;
        }
        // step commit 前 batch 里可能还残留 delta，先 flush 避免顺序错乱
        if (useBatch) batchSinkRef.current.flush();
        cb.onStepCommitted?.(p);
        return;
      }
      if (type === EVENT_AGENT_RUN_FINISHED) {
        const p = payload as AgentRunFinishedPayload;
        if (p.sessionId !== sessionId || !cb.acceptRunEvent(p.runId)) {
          return;
        }
        if (useBatch) batchSinkRef.current.flush();
        cb.onRunFinished?.(p);
        return;
      }
      if (type === EVENT_AGENT_RUN_FAILED) {
        const p = payload as AgentRunFailedPayload;
        if (p.sessionId !== sessionId || !cb.acceptRunEvent(p.runId)) {
          return;
        }
        if (useBatch) batchSinkRef.current.flush();
        cb.onRunFailed?.(p);
      }
    });
  }, [sessionId, callbacksRef, applyTextDelta, applyThinkingDelta]);

  return {
    streamingText,
    streamingThinking,
    streamingTextRef,
    onStreamReset,
  };
}
