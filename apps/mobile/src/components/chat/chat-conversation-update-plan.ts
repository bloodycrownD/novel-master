/**
 * 会话 WebView 开屏/增量判路（无宿主纯模块）。
 *
 * 为什么独立成文件：这段决策原先住在 `ChatConversationWebView.tsx` 的 effect 里，
 * 分支优先级与遥测载荷只能靠挂载 WebView 间接验证；抽成纯函数后可以表驱动单测
 * 钉死优先级（先例 `snapshot-chunk-bounds.ts`）。本模块不 import 任何宿主组件，
 * 只依赖消息类型与谓词，纯测试零 mock 即可跑。
 *
 * `planMessagesUpdate` 的分支面（spec C11）：same-reference / hidden-changed /
 * prepend / stream-adopted / force-snapshot / append / snapshot；旧的
 * committed 三态（skip-committed/consume-committed）随流式投影协议删除。
 */
import {type ChatMessageData} from '@novel-master/core/chat';
import type {TranscriptScrollIntent} from './ChatTranscriptBridge';
import type {ChatTranscriptTelemetryEvent} from '@/services/chat-transcript-telemetry';
import {messageHasToolUse, messageIsToolResultsOnly} from './message-blocks';

/** planner 只关心位置，不关心 schemaVersion（版本校验已在 parse 阶段做完）。 */
type ScrollPosition = {readonly offsetY: number; readonly nearBottom: boolean};

type OpenSnapshotInput = {
  readonly messageCount: number;
  /**
   * 有流式行（streamingRows 非空，含首字前的空 streaming 行）：空会话在 run
   * 启动时也要发只含流式行的开屏快照（spec C11）。
   */
  readonly hasStreamingMessage: boolean;
  readonly sessionKey: string;
  readonly initialScroll: ScrollPosition | null;
  readonly defaultScrollToBottom: boolean;
};

type OpenSnapshotPlan =
  | {readonly kind: 'wait-empty'}
  | {
      readonly kind: 'open';
      readonly intent: TranscriptScrollIntent;
      readonly restoreScroll?: ScrollPosition;
      readonly events: readonly ChatTranscriptTelemetryEvent[];
    };

/**
 * nm-style: keep-public — 纯决策面与 React 状态宿主隔离：effect 只读 ref / 派发副作用，
 * 分支判定与遥测载荷在此可表驱动单测（先例 snapshot-chunk-bounds.ts）；内联回 effect
 * 会让每条分支重新绑定 ref 时序，无法在不挂 WebView 的情况下钉死优先级。
 */
export function planOpenSnapshot(input: OpenSnapshotInput): OpenSnapshotPlan {
  const {
    messageCount,
    hasStreamingMessage,
    sessionKey,
    initialScroll,
    defaultScrollToBottom,
  } = input;
  if (messageCount === 0 && !hasStreamingMessage) return {kind: 'wait-empty'};
  let restoreScroll: ScrollPosition | undefined;
  if (
    !defaultScrollToBottom &&
    initialScroll != null &&
    !initialScroll.nearBottom
  ) {
    restoreScroll = {
      offsetY: initialScroll.offsetY,
      nearBottom: initialScroll.nearBottom,
    };
  }
  const intent = restoreScroll != null ? 'restore' : 'stick';
  let scrollEvent: ChatTranscriptTelemetryEvent;
  if (restoreScroll != null) {
    scrollEvent = {
      name: 'scroll_restore',
      mode: 'offset',
      offsetY: restoreScroll.offsetY,
      nearBottom: restoreScroll.nearBottom,
    };
  } else {
    scrollEvent = {name: 'scroll_restore', mode: 'stick'};
  }
  const readyEvent: ChatTranscriptTelemetryEvent = {
    name: 'transcript_ready',
    sessionKey,
    rowCount: messageCount + (hasStreamingMessage ? 1 : 0),
    hasInitialScroll: initialScroll != null,
    defaultScrollToBottom,
  };
  return {
    kind: 'open',
    intent,
    restoreScroll,
    events: [scrollEvent, readyEvent],
  };
}

type UpdateInput = {
  readonly messages: readonly ChatMessageData[];
  readonly previousMessages: readonly ChatMessageData[];
  readonly prevFirstId: string | undefined;
  readonly prevCount: number;
  readonly uiRunning: boolean;
  /** DB message id → streamId 接管映射（命中即该新增行已被流式行接管）。 */
  readonly streamRowIds: ReadonlyMap<string, string>;
  readonly lastScroll: ScrollPosition;
};

type MessagesUpdatePlan =
  | {readonly kind: 'same-reference'}
  | {readonly kind: 'hidden-changed'}
  | {
      readonly kind: 'prepend';
      readonly prependedCount: number;
      readonly event: ChatTranscriptTelemetryEvent;
    }
  | {readonly kind: 'append'; readonly added: readonly ChatMessageData[]}
  | {readonly kind: 'force-snapshot'}
  /**
   * DB 接管：新增消息全部命中 `streamRowIds`——不发 append/快照，宿主对
   * `adopted` 每一条补发 `streamStatus{row}`（终态行原地替换，spec §2.3.6）。
   */
  | {
      readonly kind: 'stream-adopted';
      readonly adopted: readonly {streamId: string; messageId: string}[];
    }
  | {readonly kind: 'snapshot'; readonly intent: 'stick' | 'preserve'};

/** nm-style: keep-public — 同上；分支优先级必须有独立纯测试钉死。 */
export function planMessagesUpdate(input: UpdateInput): MessagesUpdatePlan {
  const {
    messages,
    previousMessages,
    prevFirstId,
    prevCount,
    uiRunning,
    streamRowIds,
    lastScroll,
  } = input;
  if (previousMessages === messages) return {kind: 'same-reference'};
  const firstId = messages[0]?.id;
  const grew = messages.length > prevCount;
  const sameLength = messages.length === prevCount;
  if (sameLength && prevFirstId === firstId && prevCount > 0) {
    let hiddenChanged = false;
    for (let i = 0; i < messages.length; i += 1) {
      if (previousMessages[i]!.hidden !== messages[i]!.hidden) {
        hiddenChanged = true;
        break;
      }
    }
    if (hiddenChanged) return {kind: 'hidden-changed'};
  }
  const bothIdsKnown = prevFirstId != null && firstId != null;
  const firstChanged = bothIdsKnown && firstId !== prevFirstId;
  if (grew && firstChanged) {
    // 前插数量 = 旧首行在新列表中的下标；不能用 messages.length - prevCount
    // （那是总增长，含尾部新增）。
    const prevFirstIndex = messages.findIndex(msg => msg.id === prevFirstId);
    if (prevFirstIndex < 0) {
      // 旧首行不在新列表：头尾都可能变，无法安全前插 → 全量对账。
      return {kind: 'force-snapshot'};
    }
    const prependedCount = prevFirstIndex;
    const tailAddedCount = messages.length - prevCount - prependedCount;
    if (tailAddedCount > 0) {
      // 前插 + 尾部新增同拍：prepend 页只能发头部，尾部会丢 → 全量对账
      // （尾部 adopted 只是其中一种；任何尾部新增都走这里）。
      return {kind: 'force-snapshot'};
    }
    return {
      kind: 'prepend',
      prependedCount,
      event: {
        name: 'prepend_detected',
        prependedCount,
        wasNearBottom: lastScroll.nearBottom,
        offsetYBefore: lastScroll.offsetY,
      },
    };
  }
  // 普通追加：added 只在非 prepend 路径按 prevCount 取尾部。
  const added = grew ? messages.slice(prevCount) : [];
  const addedStream = added
    .map(message => ({
      messageId: message.id,
      streamId: streamRowIds.get(message.id),
    }))
    .filter(
      (pair): pair is {messageId: string; streamId: string} =>
        pair.streamId != null,
    );
  if (
    !firstChanged &&
    grew &&
    addedStream.length === added.length &&
    addedStream.length > 0
  ) {
    return {kind: 'stream-adopted', adopted: addedStream};
  }
  if (!firstChanged && grew && addedStream.length > 0) {
    return {kind: 'force-snapshot'};
  }
  if (uiRunning && grew) {
    const hasToolResultsOnly = added.some(messageIsToolResultsOnly);
    const hasAssistantToolUse = added.some(
      message => message.role === 'assistant' && messageHasToolUse(message),
    );
    return hasToolResultsOnly || hasAssistantToolUse
      ? {kind: 'force-snapshot'}
      : {kind: 'append', added};
  }
  const shrunk = messages.length < prevCount;
  const tailReplaced = !grew && firstChanged;
  const stick = shrunk || tailReplaced;
  const intent: 'stick' | 'preserve' = stick ? 'stick' : 'preserve';
  return {kind: 'snapshot', intent};
}
