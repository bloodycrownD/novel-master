/**
 * 主会话流式 partial 重进注入 hook（路径 A/B 共用）。
 *
 * 子会话（SubagentSessionScreen）已有同款逻辑，但主会话的 WebView 挂在
 * ChatConversationPanel 内、随 `chatSubview !== 'conversation'` 条件渲染卸载，
 * 而 ChatTabProvider 常驻不卸载——所以 webviewReady / streamInjectedRef 两个
 * 标记提升到本 hook（常驻），必须显式与 WebView 的 mount 生命周期绑定：
 *
 * - `chatSubview` 离开 'conversation'（面板卸载）；
 * - sessionKey 变化（projectId+sessionId 组合，即会话切换）；
 * - `transcriptWebRef.current` 变 null（防御性断言，通常伴随卸载发生）；
 *
 * 三者任一发生时把 webviewReady 与 streamInjectedRef 双双复位。不复位会产生
 * 两个故障：二次重进不注入（标记残留 true）；就绪前注入（ready 残留 true，
 * 注入进入未 ready 的 WebView 被 queueStreamDelta 的 webReady 守卫静默丢弃）。
 *
 * 注入资格只在本 mount 内有效：已注入（或已进入事件流式追加）后不再因
 * messages 变化重复注入；注入标记只在 step 提交（onStepCommitted →
 * resetInjection）或 mount 复位两个时机重置。
 *
 * 性能红线（docs/issues/mobile-webview-agent-stream-freeze.md）：注入走
 * pushStreamDelta imperative 通道、一次性大段低频，不触高频红线。
 */
import {useCallback, useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import type {ChatSubview} from './useChatTabScope';

/** streamRegistry 查询所需的最小接口（core AgentStreamRegistry 的结构子集）。 */
export type StreamPartialSource = {
  get(
    sessionId: string,
  ): {readonly text: string; readonly thinking: string} | undefined;
};

export type UseChatStreamResumeInjectParams = {
  /** 当前子视图：离开 'conversation' 即面板（含 WebView）卸载。 */
  readonly chatSubview: ChatSubview;
  /** 会话键（projectId+sessionId 组合）：变化即会话切换。 */
  readonly sessionKey: string;
  readonly sessionId: string | undefined;
  /** uiRunning 为 false 时无 in-flight run，注入无意义。 */
  readonly uiRunning: boolean;
  readonly transcriptWebRef: RefObject<ChatTranscriptWebViewHandle | null>;
  /** messages 数量：为 0 视为未加载完成，禁止注入（先 snapshot 后 inject）。 */
  readonly messagesLength: number;
  readonly streamRegistry: StreamPartialSource;
};

export type ChatStreamResumeInject = {
  readonly webviewReady: boolean;
  /** WebView onReady 回调：装配层接线到 ChatTranscriptWebView 的 onReady。 */
  readonly markWebviewReady: () => void;
  /** 重置注入标记：step 提交后允许下一 step 的 partial 再注入。 */
  readonly resetInjection: () => void;
};

export function useChatStreamResumeInject({
  chatSubview,
  sessionKey,
  sessionId,
  uiRunning,
  transcriptWebRef,
  messagesLength,
  streamRegistry,
}: UseChatStreamResumeInjectParams): ChatStreamResumeInject {
  const [webviewReady, setWebviewReady] = useState(false);
  // 本 mount 内是否已注入过 partial；true 期间注入 effect 直接返回。
  const streamInjectedRef = useRef(false);
  // webviewReady 的同步真源：sessionKey 变化的同一 commit 里，复位 effect 的
  // setState 尚未反映到本轮注入 effect 读到的 state（读到旧值 true 会就绪前
  // 抢先注入），所以注入守卫读 ref、state 只承担触发重跑。
  const webviewReadyRef = useRef(false);

  const markWebviewReady = useCallback(() => {
    webviewReadyRef.current = true;
    setWebviewReady(true);
  }, []);

  const resetInjection = useCallback(() => {
    streamInjectedRef.current = false;
  }, []);

  // 注入资格与 WebView mount 绑定的复位 effect：effect 依赖挂 chatSubview 与
  // sessionKey 两个可观测 state；transcriptWebRef.current === null 伴随卸载发生、
  // 不独立触发 effect，作为同 effect 内的防御性断言。
  const prevSessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    const sessionKeyChanged = prevSessionKeyRef.current !== sessionKey;
    prevSessionKeyRef.current = sessionKey;
    if (
      sessionKeyChanged ||
      chatSubview !== 'conversation' ||
      transcriptWebRef.current === null
    ) {
      webviewReadyRef.current = false;
      setWebviewReady(false);
      streamInjectedRef.current = false;
    }
  }, [chatSubview, sessionKey, transcriptWebRef]);

  // 注入 effect：守卫顺序照搬子会话——未注入 → webviewReady → uiRunning →
  // sessionId 非空 → messages 已加载（防「先 inject 后 snapshot」，applySnapshot
  // 在 sessionKey 变化 / 非 preserve 滚动意图时会整体清空 stream state，注入必须
  // 在其后）→ partial 非空 → pushStreamDelta 一次性注入。
  useEffect(() => {
    if (streamInjectedRef.current) {
      return;
    }
    if (!webviewReadyRef.current) {
      return;
    }
    if (!uiRunning) {
      return;
    }
    if (sessionId == null) {
      return;
    }
    if (messagesLength === 0) {
      return;
    }
    const partial = streamRegistry.get(sessionId);
    if (partial == null) {
      return;
    }
    if (partial.text.length === 0 && partial.thinking.length === 0) {
      return;
    }
    const web = transcriptWebRef.current;
    if (web == null) {
      return;
    }
    streamInjectedRef.current = true;
    if (partial.text.length > 0) {
      web.pushStreamDelta('text', partial.text);
    }
    if (partial.thinking.length > 0) {
      web.pushStreamDelta('thinking', partial.thinking);
    }
  }, [
    webviewReady,
    uiRunning,
    sessionId,
    messagesLength,
    streamRegistry,
    transcriptWebRef,
  ]);

  return useMemo(
    () => ({webviewReady, markWebviewReady, resetInjection}),
    [webviewReady, markWebviewReady, resetInjection],
  );
}
