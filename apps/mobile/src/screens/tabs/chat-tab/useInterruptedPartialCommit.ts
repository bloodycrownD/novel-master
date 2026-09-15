/**
 * 中断现场合成行提交（cr-fix-spec ui/B-1 / ui/C-1）：主屏
 * ChatConversationPanel 与子会话屏 SubagentSessionScreen 共用的 effect。
 *
 * 投影为 interrupted 且携带 partial 时，对当前 webview 走轻量合成提交——
 * 把 partial 组装为只读 assistant 终态行呈现（commitSyntheticAssistantRow）。
 * 以 runId+settledAtMs 为去重键：同一中断现场在同一 webview 基线上只提交
 * 一次；新 run 替换后键变化自然重置。合成行 id 非落库消息 id，菜单/编辑
 * 动作天然不可操作（不可续跑不可编辑）。
 *
 * ready 世代（ui/B-1 修复）：webview ready 前提交会被组件内 webReady 守卫
 * 拒绝且不置去重键，重进 interrupted 会话的常态时序又是 tail 先于 webview
 * ready 到达——只依赖投影变化重跑的话此后 effect 不再触发，partial 永不
 * 提交。因此把 readyEpoch 纳入依赖：ready（世代递增）后 effect 重跑补交。
 * 世代也参与去重：webview 重挂（切会话/repaintEpoch）后是新的空基线，
 * 落库消息会经快照链重推、合成行不在落库消息里，须在新世代重新提交。
 */
import {useEffect, useRef} from 'react';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import type {SessionStreamUnitView} from '@/services/session-stream-unit';

export interface UseInterruptedPartialCommitOptions {
  /** 订阅到的单元投影（interrupted 且 partial 非空才动作）。 */
  readonly unitView: SessionStreamUnitView | null;
  /** webview 句柄 ref（commitSyntheticAssistantRow 的落点）。 */
  readonly webRef: React.RefObject<ChatTranscriptWebViewHandle | null>;
  /** webview ready 世代：0 = 尚未 ready，每次 onReady 递增（重挂亦递增）。 */
  readonly readyEpoch: number;
}

export function useInterruptedPartialCommit({
  unitView,
  webRef,
  readyEpoch,
}: UseInterruptedPartialCommitOptions): void {
  // 已提交记录（键 + 提交时的世代）：同键同世代不重复提交；世代变化
  // （新基线）后同键重新提交，见模块头注释的 ui/B-1 说明。
  const committedRef = useRef<{key: string; epoch: number} | null>(null);

  useEffect(() => {
    if (unitView?.status !== 'interrupted') {
      return;
    }
    if (
      unitView.partialText.length === 0 &&
      unitView.partialThinking.length === 0
    ) {
      return;
    }
    if (readyEpoch === 0) {
      // webview 尚未 ready：显式早退（不置去重键），等 ready 世代递增后
      // 依赖变化重跑再提交——这正是 ui/B-1 修的时序。
      return;
    }
    const web = webRef.current;
    if (web == null) {
      return;
    }
    const key = `${unitView.runId ?? ''}:${unitView.settledAtMs ?? 0}`;
    const committed = committedRef.current;
    if (
      committed != null &&
      committed.key === key &&
      committed.epoch === readyEpoch
    ) {
      return;
    }
    if (
      web.commitSyntheticAssistantRow(
        unitView.partialText,
        unitView.partialThinking,
      )
    ) {
      committedRef.current = {key, epoch: readyEpoch};
    }
  }, [unitView, webRef, readyEpoch]);
}
