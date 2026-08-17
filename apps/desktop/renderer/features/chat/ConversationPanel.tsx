import {
  isPlainUserUndoSendEligible,
  parseComposerDraftJson,
  resolveRollbackConfirmMessage,
  serializeComposerDraftJson,
  type RollbackMode,
} from '@shared/logic/chat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatMessageDto,
  MessageAttachmentDto,
} from '@shared/ipc-types';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  AgentStepCommittedPayload,
} from '@novel-master/core/events';
import { useAgentStream, type UseAgentStreamCallbacks } from '@/hooks/useAgentStream';
import { useAgentRunLifecycle, shouldApplyTranscriptReload } from '@/hooks/useAgentRunLifecycle';
import { useChatMessagesScrollFollow } from '@/hooks/useChatMessagesScrollFollow';
import { useAgentStreamMetrics } from '@/hooks/useAgentStreamMetrics';
import { useDesktopAgentActive } from '@/hooks/useDesktopAgentActive';
import {
  ipcAppUiGet,
  ipcAgentAbort,
  ipcAgentRunIsActive,
  ipcCompactionManual,
  ipcMessagesEdit,
  ipcMessagesFork,
  ipcMessagesList,
  ipcMessagesRollback,
  ipcMessagesSetFloor,
  ipcSessionsGetComposerDraft,
  ipcSessionsProjectComposerStatus,
  ipcSessionsSetComposerDraft,
} from '@/ipc/client';
import { useShellNav } from '@/providers/ShellNavProvider';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { showToast } from '@/components/ui/show-toast';
import { formatUserError } from '@/utils/format-user-error';
import { ChatComposer } from './ChatComposer';
import {
  unionComposerStatusWithAnnotate,
} from './chat-annotate-draft';
import {
  deriveComposerSendState,
  findLastVisibleMessageDto,
  chatMessageFromDto,
} from './composer-send-state';
import {
  buildMessageActionItems,
  editableTextFromMessage,
} from './message-edit';
import { resolveComposerDraftAfterRollbackSuccess } from './rollback-composer';
import { applyUndoAnnotateRestore } from './rollback-annotate-restore';
import { MessageEditModal } from './MessageEditModal';
import {
  handleRunFinishedAbortRetain,
  handleStepCommittedAbortRetain,
} from './conversation-abort-retain';
import { MessageList } from './MessageList';
import { RealPromptPanel } from './RealPromptPanel';
import { AgentStreamMetricsBar } from './AgentStreamMetricsBar';
import { useReadOnlyRunProbe } from './useReadOnlyRunProbe';

interface ConversationPanelProps {
  projectId: string;
  sessionId: string;
  onOpenSessionActions: (anchor: HTMLElement) => void;
  /**
   * 只读模式：用于子智能体会话浏览。开启后不渲染 Composer、不写入草稿 IPC、
   * 不允许消息右键菜单（hide/edit/rollback 等写操作）。读消息 / 跳转预览仍可用。
   */
  readOnly?: boolean;
  /** 点击 task 工具卡片时跳转只读子会话面板；仅需在父面板传入。 */
  onOpenSubagentSession?: (sessionId: string) => void;
  /**
   * 运行态上报（Phase 3 Step 23）：只读子会话面板的停止按钮需要知道
   * 子 agent 是否在跑。父级（ChatRail）用这个回调订阅 running 变化。
   */
  onRunningChange?: (running: boolean) => void;
}

type RollbackConfirmContext = {
  rollbackMode: RollbackMode;
  restoreText: string | null;
  restoreAttachments: readonly MessageAttachmentDto[] | null;
};

type ConfirmState =
  | { kind: 'set-floor'; messageId: string }
  | ({ kind: 'rollback'; messageId: string } & RollbackConfirmContext)
  | ({
      kind: 'rollback-backfill';
      messageId: string;
      missingLogicalPaths: readonly string[];
    } & RollbackConfirmContext)
  | ({
      kind: 'rollback-degraded';
      messageId: string;
      errorMessage: string;
    } & RollbackConfirmContext)
  | null;

export function ConversationPanel({
  projectId,
  sessionId,
  onOpenSessionActions,
  readOnly = false,
  onOpenSubagentSession,
  onRunningChange,
}: ConversationPanelProps) {
  const {
    notifyWorkspaceMutated,
    openSession,
    projectName,
    openChatWorkspacePreview,
    reloadFooter,
    viewPromptRequest,
  } = useShellNav();
  const vfsMutatedInRunRef = useRef(false);
  const [tab, setTab] = useState<'chat' | 'realPrompt'>('chat');
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);

  const runLifecycle = useAgentRunLifecycle();
  const {
    uiRunning: running,
    acceptRunEvent,
    beginUiRun,
    abortUiRun: abortUiRunBase,
    getUiRunning,
    getTranscriptFreezeCount,
    getAbortRetainPending,
    clearAbortRetainPending,
    onRunStarted,
    onRunFinished: finishUiRun,
    onRunFailed: failUiRun,
    resetUiForSessionChange,
    markExternalRunActive,
    markExternalRunEnded,
  } = runLifecycle;

  const abortUiRun = useCallback(() => {
    // Phase 3 Step 19：abort 单元自己经 IPC 调 core registry，
    // ChatComposer / ChatRail 停止按钮只调本函数即可，不再单独发 ipcAgentAbort。
    abortUiRunBase(messages.length);
    void ipcAgentAbort({ sessionId });
  }, [abortUiRunBase, messages.length, sessionId]);

  const agentActive = useDesktopAgentActive();

  // Phase 3 Step 20：stream 单元提前实例化，拿回 streamingText /
  // streamingThinking / streamingTextRef / onStreamReset 给下面的
  // session 切换 effect 与 onStepCommitted / onRunFinished / onRunFailed 使用。
  // 回调集合走 ref（callbacksRef）：本帧稍后定义完回调再写入 ref.current，
  // useAgentStream 在事件到达时现读——不依赖定义顺序，与 Mobile P1-2 对称。
  const streamCallbacksRef = useRef<UseAgentStreamCallbacks>({
    acceptRunEvent: () => false,
    getUiRunning: () => false,
  });
  const {
    streamingText,
    streamingThinking,
    streamingTextRef,
    onStreamReset,
  } = useAgentStream({
    sessionId,
    callbacksRef: streamCallbacksRef,
    batchEnabled: true,
  });

  useEffect(() => {
    if (running) {
      vfsMutatedInRunRef.current = false;
    }
  }, [running]);

  // Phase 3 Step 23：把 running 上报给父级（ChatRail 只读面板的停止按钮用）。
  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);
  const {
    metrics: streamMetrics,
    noteTextDelta: noteMetricsTextDelta,
    noteThinkingDelta: noteMetricsThinkingDelta,
  } = useAgentStreamMetrics(running);
  const [composerError, setComposerError] = useState<string | undefined>();
  const [composerText, setComposerText] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<
    MessageAttachmentDto[]
  >([]);
  const composerDraftHydratedRef = useRef(false);
  const [chatRichText, setChatRichText] = useState(true);
  const [messageMenu, setMessageMenu] = useState<{
    message: ChatMessageDto;
    x: number;
    y: number;
  } | null>(null);
  const [messageEdit, setMessageEdit] = useState<{
    messageId: string;
    initialText: string;
  } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const reloadMessages = useCallback(async () => {
    const result = await ipcMessagesList({ sessionId });
    if (result.ok) {
      setMessages(result.data);
    }
    // messages changed → 刷新页脚 token（与 Mobile refreshChatTokenLabel 对称）
    reloadFooter();
  }, [sessionId, reloadFooter]);

  const composerSendState = useMemo(
    () => deriveComposerSendState(findLastVisibleMessageDto(messages)),
    [messages],
  );

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);

  // 手动压缩成功后重新拉取消息列表（旧消息 hidden 已在 DB 置 true，前端需刷新才能看到降透明度）
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ sessionId: string }>).detail?.sessionId === sessionId) {
        void reloadMessages();
      }
    };
    window.addEventListener('session-compacted', handler);
    return () => window.removeEventListener('session-compacted', handler);
  }, [sessionId, reloadMessages]);

  // 详情抽屉「查看提示词」请求：切到 realPrompt tab
  useEffect(() => {
    if (viewPromptRequest?.token && viewPromptRequest.token > 0) {
      setTab('realPrompt');
    }
  }, [viewPromptRequest]);

  // 切换会话：重置 UI 运行态；从 DB 水化 attach+text 并投影状态条
  useEffect(() => {
    resetUiForSessionChange();
    onStreamReset();
    setComposerError(undefined);
    composerDraftHydratedRef.current = false;
    setComposerText('');
    setComposerAttachments([]);

    if (readOnly) {
      // 只读面板不水化草稿、不订阅写 IPC。
      return;
    }

    let cancelled = false;
    void (async () => {
      const [draftRes, statusRes] = await Promise.all([
        ipcSessionsGetComposerDraft({ sessionId }),
        ipcSessionsProjectComposerStatus({ sessionId }),
      ]);
      if (cancelled) {
        return;
      }
      const draft = parseComposerDraftJson(
        draftRes.ok ? draftRes.data : null,
      );
      const status = statusRes.ok ? statusRes.data : [];
      setComposerText(draft.text);
      // 历史 draft attach chip 丢弃；文件引用只认正文 `@路径`
      // 投影直接作状态条，再 ∪ annotate（切会话回来 store 未清则 chip 仍在）
      setComposerAttachments(
        unionComposerStatusWithAnnotate(status, sessionId),
      );
      composerDraftHydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, resetUiForSessionChange, onStreamReset, readOnly]);

  // 水化完成后：仅持久 attach+text（状态条不进列）
  useEffect(() => {
    if (readOnly) {
      return;
    }
    if (!composerDraftHydratedRef.current) {
      return;
    }
    // draft attach 恒空；仅持久正文（含 `@路径`）
    const draftJson = serializeComposerDraftJson({
      text: composerText,
      attachments: [],
    });
    void ipcSessionsSetComposerDraft({ sessionId, draftJson });
  }, [sessionId, composerText, composerAttachments, readOnly]);

  useEffect(() => {
    ipcAppUiGet('chatRichText')
      .then(res =>
        setChatRichText(
          res.ok && res.data != null ? res.data !== 'false' : true,
        ),
      )
      .catch(() => undefined);
  }, []);

  const abortRetainLifecycle = useMemo(
    () => ({
      getUiRunning,
      getTranscriptFreezeCount,
      getAbortRetainPending,
      clearAbortRetainPending,
    }),
    [
      getUiRunning,
      getTranscriptFreezeCount,
      getAbortRetainPending,
      clearAbortRetainPending,
    ],
  );

  const onStepCommitted = useCallback(
    (payload: AgentStepCommittedPayload) => {
      handleStepCommittedAbortRetain(
        payload,
        abortRetainLifecycle,
        reloadMessages,
        onStreamReset,
      );
      // Desktop-only 实时消费方 ①：Agent 工具突变后立即刷新 Explorer
      if (payload.vfsMutated) {
        vfsMutatedInRunRef.current = true;
        notifyWorkspaceMutated();
      }
    },
    [
      abortRetainLifecycle,
      reloadMessages,
      onStreamReset,
      notifyWorkspaceMutated,
    ],
  );

  const onRunFinished = useCallback(
    (payload: AgentRunFinishedPayload) => {
      const shouldReload = shouldApplyTranscriptReload(
        getUiRunning(),
        getTranscriptFreezeCount(),
      );
      const accepted = handleRunFinishedAbortRetain(payload, abortRetainLifecycle, {
        finishUiRun,
        shouldReloadAfterFinish: shouldReload,
        streamingText: streamingTextRef.current,
        sessionId,
        reloadMessages,
        onStreamReset,
      });
      if (!accepted) {
        return;
      }
      if (payload.vfsMutated) {
        notifyWorkspaceMutated();
      }
      vfsMutatedInRunRef.current = false;
    },
    [
      abortRetainLifecycle,
      finishUiRun,
      getUiRunning,
      getTranscriptFreezeCount,
      streamingTextRef,
      sessionId,
      reloadMessages,
      onStreamReset,
      notifyWorkspaceMutated,
    ],
  );

  const onRunFailed = useCallback(
    (payload: AgentRunFailedPayload) => {
      const shouldReload = shouldApplyTranscriptReload(
        getUiRunning(),
        getTranscriptFreezeCount(),
      );
      if (!failUiRun(payload)) {
        return;
      }
      onStreamReset();
      if (vfsMutatedInRunRef.current) {
        notifyWorkspaceMutated();
      }
      vfsMutatedInRunRef.current = false;
      setComposerError(formatUserError(payload.error));
      showToast(payload.error);
      if (shouldReload) {
        void reloadMessages();
      }
    },
    [
      failUiRun,
      reloadMessages,
      notifyWorkspaceMutated,
      getUiRunning,
      getTranscriptFreezeCount,
      onStreamReset,
    ],
  );

  // ===== FR8-1：readOnly 子面板放宽守卫（对齐 mobile SubagentSessionScreen）=====
  //
  // readOnly 子会话的典型时序是「面板晚于 run 启动」：mount 时 RUN_STARTED 已是历史。
  // 主会话的 beginUiRun + shouldAcceptRunEvent 守卫在这个场景断裂（beginUiRun 先把
  // activeRunId 置 null，迟到 RUN_FINISHED 被守卫拒绝 → uiRunning 卡死）。
  // 这里另起一套回调：acceptRunEvent 放宽为非空 runId 即接受、不碰 activeRunId、
  // 只翻 uiRunning + 触发 reload。
  const readOnlyAcceptRunEvent = useCallback(
    (runId: string | undefined) => runId != null && runId !== '',
    [],
  );
  const readOnlyOnRunStarted = useCallback(
    (_payload: AgentRunStartedPayload) => {
      markExternalRunActive();
      void reloadMessages();
    },
    [markExternalRunActive, reloadMessages],
  );
  const readOnlyOnRunFinished = useCallback(
    (payload: AgentRunFinishedPayload) => {
      markExternalRunEnded();
      onStreamReset();
      if (payload.vfsMutated) {
        notifyWorkspaceMutated();
      }
      void reloadMessages();
    },
    [markExternalRunEnded, onStreamReset, reloadMessages, notifyWorkspaceMutated],
  );
  const readOnlyOnRunFailed = useCallback(
    (payload: AgentRunFailedPayload) => {
      markExternalRunEnded();
      onStreamReset();
      if (vfsMutatedInRunRef.current) {
        notifyWorkspaceMutated();
      }
      vfsMutatedInRunRef.current = false;
      void reloadMessages();
    },
    [markExternalRunEnded, onStreamReset, reloadMessages, notifyWorkspaceMutated],
  );

  // readOnly mount probe：主动查 IPC 该 session 是否有 in-flight run，
  // 若有则 markExternalRunActive 初始化 uiRunning=true（不调 beginUiRun、不动 activeRunId）。
  //
  // FR8-1 风险4 IPC 往返竞态防护：useAgentStream 的 bus 订阅比本 effect 先 mount，
  // 极端时序下 run 可能在 IPC 往返期间结束——迟到 RUN_FINISHED 先到→markExternalRunEnded
  // 把 endedRef 置位→markExternalRunActive 退化为 no-op，uiRunning 不会错误翻回 true。
  // 再补一次复询：若第二次查询返回 false（run 确实已结束），markExternalRunEnded 兑底。
  useEffect(() => {
    if (!readOnly || sessionId == null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await ipcAgentRunIsActive({ sessionId });
      if (cancelled) {
        return;
      }
      if (res.ok && res.data) {
        markExternalRunActive();
        void reloadMessages();
        // 竞态校正：IPC 往返期间 run 可能已结束，复询一次兑底。
        const recheck = await ipcAgentRunIsActive({ sessionId });
        if (cancelled) {
          return;
        }
        if (recheck.ok && !recheck.data) {
          markExternalRunEnded();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 mount / sessionId 切换时 probe
  }, [sessionId, readOnly]);

  // ===== readOnly 子面板「生成中」状态兜底（避免事件丢失导致 uiRunning 永久残留） =====
  //
  // 逻辑抽到 useReadOnlyRunProbe，这里只注入依赖。跨进程查 main 的 in-flight 状态，
  // 比.mobile 的 registry 查询语义更强；但 IPC 可能短暂抖动，所以 hook 内部查到 false 后会复询一次防抖。
  useReadOnlyRunProbe({
    enabled: readOnly,
    sessionId,
    isRunActive: getUiRunning,
    onRunEnded: () => {
      markExternalRunEnded();
      onStreamReset();
      void reloadMessages();
    },
  });

  // Phase 3 Step 20：stream 单元在组件顶部已实例化（拿回 streamingText /
  // streamingTextRef / onStreamReset）。这里把定义完的生命周期回调 + 守卫
  // 同步写入 callbacksRef，让 useAgentStream 的事件订阅现读最新值。
  streamCallbacksRef.current = readOnly
    ? {
        acceptRunEvent: readOnlyAcceptRunEvent,
        getUiRunning,
        noteTextDelta: noteMetricsTextDelta,
        noteThinkingDelta: noteMetricsThinkingDelta,
        onRunStarted: readOnlyOnRunStarted,
        onStepCommitted,
        onRunFinished: readOnlyOnRunFinished,
        onRunFailed: readOnlyOnRunFailed,
      }
    : {
        acceptRunEvent,
        getUiRunning,
        noteTextDelta: noteMetricsTextDelta,
        noteThinkingDelta: noteMetricsThinkingDelta,
        onRunStarted,
        onStepCommitted,
        onRunFinished,
        onRunFailed,
      };

  const chatMessagesRef = useRef<HTMLDivElement>(null);
  useChatMessagesScrollFollow(chatMessagesRef, {
    streamingText: running ? streamingText : undefined,
    streamingThinking: running ? streamingThinking : undefined,
    streamTailGenerating: running,
    messagesLength: messages.length,
    running,
    sessionId,
  });

  const closeMessageMenu = useCallback(() => {
    setMessageMenu(null);
  }, []);

  useEffect(() => {
    const onDocClick = () => closeMessageMenu();
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [closeMessageMenu]);

  const openMessageMenu = useCallback(
    (message: ChatMessageDto, position: { x: number; y: number }) => {
      setMessageMenu({
        message,
        x: Math.max(8, Math.min(position.x, window.innerWidth - 180)),
        y: Math.max(8, Math.min(position.y, window.innerHeight - 200)),
      });
    },
    [],
  );

  const menuItems = useMemo(
    () => (messageMenu ? buildMessageActionItems(messageMenu.message) : []),
    [messageMenu],
  );

  const copyMessage = useCallback(async (message: ChatMessageDto) => {
    const text = editableTextFromMessage(message) ?? message.bodyText?.trim();
    if (!text) {
      showToast('该消息没有可复制的文本');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制');
    } catch {
      showToast('复制失败');
    }
  }, []);

  const resolveRollbackContext = useCallback(
    (messageId: string): RollbackConfirmContext => {
      const target = messages.find(m => m.id === messageId);
      if (target == null) {
        return {
          rollbackMode: 'rewind',
          restoreText: null,
          restoreAttachments: null,
        };
      }
      const chatMsg = chatMessageFromDto(target);
      return {
        rollbackMode: isPlainUserUndoSendEligible(chatMsg)
          ? 'undo_send'
          : 'rewind',
        restoreText: editableTextFromMessage(target),
        restoreAttachments: target.attachments ?? null,
      };
    },
    [messages],
  );

  const rollbackToMessage = useCallback(
    async (messageId: string) => {
      if (running) {
        showToast('Agent 运行中无法回滚');
        return;
      }
      setConfirmState({
        kind: 'rollback',
        messageId,
        ...resolveRollbackContext(messageId),
      });
    },
    [running, resolveRollbackContext],
  );

  const executeRollback = useCallback(
    async (
      messageId: string,
      options?: {
        skipVfsReconcile?: boolean;
        revisionHeadBackfill?: boolean;
        rollbackMode?: RollbackMode;
        restoreText?: string | null;
        restoreAttachments?: readonly MessageAttachmentDto[] | null;
      },
    ) => {
      const rollbackMode = options?.rollbackMode ?? 'rewind';
      const restoreText = options?.restoreText ?? null;
      const restoreAttachments = options?.restoreAttachments ?? null;
      const result = await ipcMessagesRollback({
        projectId,
        sessionId,
        messageId,
        ...(options?.skipVfsReconcile ? { skipVfsReconcile: true } : {}),
        ...(options?.revisionHeadBackfill
          ? { revisionHeadBackfill: true }
          : {}),
      });
      if (!result.ok) {
        if (result.error.code === 'ROLLBACK_REVISION_BACKFILL_REQUIRED') {
          setConfirmState({
            kind: 'rollback-backfill',
            messageId,
            missingLogicalPaths: result.error.missingLogicalPaths ?? [],
            rollbackMode,
            restoreText,
            restoreAttachments,
          });
          return;
        }
        if (result.error.code === 'ROLLBACK_VFS_RESTORE_FAILED') {
          setConfirmState({
            kind: 'rollback-degraded',
            messageId,
            errorMessage: result.error.message,
            rollbackMode,
            restoreText,
            restoreAttachments,
          });
          return;
        }
        showToast(result.error.message);
        return;
      }
      onStreamReset();
      await reloadMessages();
      if (!options?.skipVfsReconcile) {
        notifyWorkspaceMutated();
      }
      // 通知 SessionDetailDrawer 这类订阅方刷新（与 session-compacted 同范式，按 sessionId 过滤）
      window.dispatchEvent(
        new CustomEvent('messages-rollback', { detail: { sessionId } }),
      );
      // D8：main 已推空 ops；renderer 仅正文 + annotate ∪（禁止用 prev 盖回旧 user_ops chip）
      setComposerText(prevText => {
        const next = resolveComposerDraftAfterRollbackSuccess(
          { text: prevText, attachments: [] },
          rollbackMode,
          { text: restoreText, attachments: restoreAttachments },
        );
        setComposerAttachments(
          applyUndoAnnotateRestore(
            sessionId,
            // undo_send ↔ user 锚点：保留未发送草稿 + 反投影；rewind ↔ assistant 锚点：清空。
            rollbackMode === 'undo_send' ? 'user' : 'assistant',
            rollbackMode === 'undo_send' ? restoreAttachments : null,
            [],
          ),
        );
        return next.text;
      });
      showToast(
        options?.skipVfsReconcile ? '对话已截断，工作区未恢复' : '回滚成功',
      );
    },
    [projectId, sessionId, reloadMessages, notifyWorkspaceMutated, onStreamReset],
  );

  const handleMessageAction = useCallback(
    async (message: ChatMessageDto, action: string) => {
      if (action === 'edit') {
        const initial = editableTextFromMessage(message);
        if (initial == null) {
          showToast('该消息没有可编辑的文本');
          return;
        }
        // 编辑走 MessageEditModal，不写 Composer；否则取消后输入框会残留消息正文。
        // T-TX2 的 Composer 回填仅适用于 undo_send。
        setMessageEdit({ messageId: message.id, initialText: initial });
        return;
      }
      if (action === 'copy') {
        await copyMessage(message);
        return;
      }
      if (action === 'set-floor') {
        if (running) {
          showToast('Agent 运行中无法置位');
          return;
        }
        setConfirmState({ kind: 'set-floor', messageId: message.id });
        return;
      }
      if (action === 'fork') {
        if (running) {
          showToast('Agent 运行中无法分叉');
          return;
        }
        const result = await ipcMessagesFork({
          sessionId,
          messageId: message.id,
        });
        if (!result.ok) {
          showToast(result.error.message);
          return;
        }
        onStreamReset();
        await openSession(result.data, projectName ?? '—');
        return;
      }
      if (action === 'rollback') {
        await rollbackToMessage(message.id);
      }
    },
    [
      running,
      sessionId,
      copyMessage,
      rollbackToMessage,
      openSession,
      projectName,
      onStreamReset,
    ],
  );

  const saveMessageEdit = useCallback(
    async (messageId: string, text: string) => {
      const result = await ipcMessagesEdit({ messageId, text });
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      await reloadMessages();
    },
    [reloadMessages],
  );

  const handleConfirm = useCallback(async () => {
    const state = confirmState;
    setConfirmState(null);
    if (!state) return;
    if (state.kind === 'rollback') {
      await executeRollback(state.messageId, {
        rollbackMode: state.rollbackMode,
        restoreText: state.restoreText,
        restoreAttachments: state.restoreAttachments,
      });
    } else if (state.kind === 'rollback-backfill') {
      await executeRollback(state.messageId, {
        revisionHeadBackfill: true,
        rollbackMode: state.rollbackMode,
        restoreText: state.restoreText,
        restoreAttachments: state.restoreAttachments,
      });
    } else if (state.kind === 'rollback-degraded') {
      await executeRollback(state.messageId, {
        skipVfsReconcile: true,
        rollbackMode: state.rollbackMode,
        restoreText: state.restoreText,
        restoreAttachments: state.restoreAttachments,
      });
    } else if (state.kind === 'set-floor') {
      const result = await ipcMessagesSetFloor({
        projectId,
        sessionId,
        messageId: state.messageId,
      });
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      const changed = result.data.hiddenCount + result.data.shownCount > 0;
      await reloadMessages();
      notifyWorkspaceMutated();
      showToast(changed ? '已置位' : '上下文已是最新状态');
      // 置位改变了上下文范围，token 计数随之变化。派发 context-changed 让
      // SessionDetailDrawer 这类订阅方按 sessionId 过滤后刷新自己的统计（回滚仍走 messages-rollback，不复用同一事件以免语义混淆）。
      window.dispatchEvent(
        new CustomEvent('context-changed', { detail: { sessionId } }),
      );
    }
  }, [
    confirmState,
    projectId,
    sessionId,
    executeRollback,
    reloadMessages,
    notifyWorkspaceMutated,
  ]);

  const confirmMessage = (() => {
    if (!confirmState) return '';
    if (confirmState.kind === 'set-floor') {
      return '此消息之前将不参与提示词，此消息及之后将恢复可见。';
    }
    if (confirmState.kind === 'rollback-degraded') {
      return `${confirmState.errorMessage}\n\n${resolveRollbackConfirmMessage(
        confirmState.rollbackMode,
        'degraded',
      )}`;
    }
    if (confirmState.kind === 'rollback-backfill') {
      return resolveRollbackConfirmMessage(
        confirmState.rollbackMode,
        'backfill',
        { missingPaths: confirmState.missingLogicalPaths },
      );
    }
    if (confirmState.kind === 'rollback') {
      return resolveRollbackConfirmMessage(
        confirmState.rollbackMode,
        'primary',
      );
    }
    return '';
  })();

  const confirmTitle =
    confirmState?.kind === 'set-floor'
      ? '置位到此消息？'
      : confirmState?.kind === 'rollback-degraded'
      ? '无法恢复工作区'
      : confirmState?.kind === 'rollback-backfill'
      ? '快照丢失'
      : '确认操作';

  const confirmLabel =
    confirmState?.kind === 'set-floor'
      ? '置位'
      : confirmState?.kind === 'rollback-degraded'
      ? '仅删除后续对话'
      : confirmState?.kind === 'rollback-backfill'
      ? '继续回滚'
      : '确定';

  return (
    <>
      <div className="conversation-tabs" role="tablist" aria-label="会话内容">
        <button
          type="button"
          className={`conversation-tab${tab === 'chat' ? ' is-active' : ''}`}
          data-conversation-tab="chat"
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
        >
          聊天
        </button>
        <button
          type="button"
          className={`conversation-tab${
            tab === 'realPrompt' ? ' is-active' : ''
          }`}
          data-conversation-tab="realPrompt"
          role="tab"
          aria-selected={tab === 'realPrompt'}
          onClick={() => setTab('realPrompt')}
        >
          提示词
        </button>
      </div>
      <div
        className={`conversation-panel${tab === 'chat' ? ' is-visible' : ''}`}
        data-conversation-panel="chat"
        hidden={tab !== 'chat'}
      >
        {streamMetrics != null ? (
          <AgentStreamMetricsBar metrics={streamMetrics} />
        ) : null}
        <div ref={chatMessagesRef} className="chat-messages" id="chat-messages">
          <MessageList
            messages={messages}
            projectId={projectId}
            uiRunning={running}
            streamingText={running ? streamingText : undefined}
            streamingThinking={running ? streamingThinking : undefined}
            streamTailGenerating={running}
            agentRunning={agentActive}
            chatRichText={chatRichText}
            onOpenMessageMenu={readOnly ? undefined : openMessageMenu}
            onOpenToolFile={openChatWorkspacePreview}
            onOpenSubagentSession={onOpenSubagentSession}
          />
        </div>
        <div
          id="message-actions-menu"
          className={`message-actions-menu${messageMenu ? '' : ' hidden'}`}
          role="menu"
          aria-label="消息操作"
          hidden={!messageMenu}
          style={
            messageMenu
              ? { left: messageMenu.x, top: messageMenu.y }
              : undefined
          }
          onClick={e => e.stopPropagation()}
        >
          {menuItems.map(item => (
            <button
              key={item.action}
              type="button"
              data-message-action={item.action}
              className={item.danger ? 'is-danger' : undefined}
              onClick={() => {
                const target = messageMenu?.message;
                closeMessageMenu();
                if (target) {
                  void handleMessageAction(target, item.action);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <MessageEditModal
          open={messageEdit != null}
          title="编辑消息"
          initialValue={messageEdit?.initialText ?? ''}
          onClose={() => setMessageEdit(null)}
          onConfirm={async value => {
            const edit = messageEdit;
            setMessageEdit(null);
            if (edit) {
              await saveMessageEdit(edit.messageId, value);
            }
          }}
        />
        {readOnly ? null : (
          <ChatComposer
            projectId={projectId}
            sessionId={sessionId}
            value={composerText}
            onChange={setComposerText}
            attachments={composerAttachments}
            onAttachmentsChange={setComposerAttachments}
            running={running}
            canResumeWithoutInput={composerSendState.canResumeWithoutInput}
            lastMessageHasToolResult={composerSendState.lastMessageHasToolResult}
            lastMessageIsPlainUserText={
              composerSendState.lastMessageIsPlainUserText
            }
            error={composerError}
            onErrorChange={setComposerError}
            beginUiRun={beginUiRun}
            abortUiRun={abortUiRun}
            onStreamReset={onStreamReset}
            onMessagesChanged={reloadMessages}
            onOpenSessionActions={onOpenSessionActions}
          />
        )}
      </div>
      <div
        className={`conversation-panel${
          tab === 'realPrompt' ? ' is-visible' : ''
        }`}
        data-conversation-panel="realPrompt"
        hidden={tab !== 'realPrompt'}
      >
        <RealPromptPanel
          projectId={projectId}
          sessionId={sessionId}
          visible={tab === 'realPrompt'}
        />
      </div>
      <ConfirmModal
        open={confirmState != null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        danger={
          confirmState?.kind === 'rollback' ||
          confirmState?.kind === 'rollback-backfill' ||
          confirmState?.kind === 'rollback-degraded'
        }
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </>
  );
}

/** 手动压缩：成功后派发 session-compacted 事件，让 ConversationPanel 重新拉取消息列表。 */
export async function runCompaction(
  projectId: string,
  sessionId: string,
): Promise<void> {
  const result = await ipcCompactionManual({ projectId, sessionId });
  if (!result.ok) {
    showToast(result.error.message);
    return;
  }
  if (!result.data.ok) {
    showToast('压缩部分失败');
    return;
  }
  showToast('已压缩');
  // 压缩成功后 DB 里旧消息的 hidden 已置 true，但前端内存里的消息列表不会自动刷新。
  // session-compacted：让 ConversationPanel 重新拉取消息列表，使隐藏样式即时生效。
  window.dispatchEvent(
    new CustomEvent('session-compacted', { detail: { sessionId } }),
  );
  // context-changed：上下文范围变了，token 计数也要刷新。SessionDetailDrawer
  // 订阅它来 reload 自己的统计（与置位共用同一事件，便于统一维护）。
  window.dispatchEvent(
    new CustomEvent('context-changed', { detail: { sessionId } }),
  );
}
