import {
  isPlainUserUndoSendEligible,
  parseComposerDraftJson,
  replaceComposerStatusAttachments,
  resolveRollbackConfirmMessage,
  serializeComposerDraftJson,
  type RollbackMode,
} from '@novel-master/core/chat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatMessageDto,
  MessageAttachmentDto,
} from '@shared/ipc-types';
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentStepCommittedPayload,
} from '@shared/agent-event-types';
import { useAgentStream } from '@/hooks/useAgentStream';
import { useAgentRunLifecycle, shouldApplyTranscriptReload } from '@/hooks/useAgentRunLifecycle';
import { useChatMessagesScrollFollow } from '@/hooks/useChatMessagesScrollFollow';
import { useAgentStreamMetrics } from '@/hooks/useAgentStreamMetrics';
import { useDesktopAgentActive } from '@/hooks/useDesktopAgentActive';
import {
  ipcAppUiGet,
  ipcCompactionManual,
  ipcMessagesEdit,
  ipcMessagesFork,
  ipcMessagesList,
  ipcMessagesRollback,
  ipcMessagesSetFloor,
  ipcSessionsGetComposerDraft,
  ipcSessionsProjectComposerStatus,
  ipcSessionsSetComposerDraft,
  ipcUserVfsHasPending,
  onWorkspaceMutated,
} from '@/ipc/client';
import { useShellNav } from '@/providers/ShellNavProvider';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { showToast } from '@/components/ui/show-toast';
import { formatUserError } from '@/utils/format-user-error';
import { ChatComposer } from './ChatComposer';
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
import { MessageEditModal } from './MessageEditModal';
import {
  handleRunFinishedAbortRetain,
  handleStepCommittedAbortRetain,
  shouldAcceptStreamIngress,
} from './conversation-abort-retain';
import { MessageList } from './MessageList';
import { RealPromptPanel } from './RealPromptPanel';
import { AgentStreamMetricsBar } from './AgentStreamMetricsBar';

interface ConversationPanelProps {
  projectId: string;
  sessionId: string;
  onOpenSessionActions: (anchor: HTMLElement) => void;
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
}: ConversationPanelProps) {
  const {
    notifyWorkspaceMutated,
    openSession,
    projectName,
    openChatWorkspacePreview,
  } = useShellNav();
  const vfsMutatedInRunRef = useRef(false);
  const [tab, setTab] = useState<'chat' | 'realPrompt'>('chat');
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const streamingTextRef = useRef('');

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
  } = runLifecycle;

  const abortUiRun = useCallback(() => {
    abortUiRunBase(messages.length);
  }, [abortUiRunBase, messages.length]);

  const agentActive = useDesktopAgentActive();

  const onStreamReset = useCallback(() => {
    streamingTextRef.current = '';
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  useEffect(() => {
    if (running) {
      vfsMutatedInRunRef.current = false;
    }
  }, [running]);
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
  const [hasPendingUserOps, setHasPendingUserOps] = useState(false);
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

  const refreshPendingUserOps = useCallback(async () => {
    const result = await ipcUserVfsHasPending({ sessionId });
    if (result.ok) {
      setHasPendingUserOps(result.data);
    }
  }, [sessionId]);

  const reloadMessages = useCallback(async () => {
    const result = await ipcMessagesList({ sessionId });
    if (result.ok) {
      setMessages(result.data);
    }
    await refreshPendingUserOps();
  }, [sessionId, refreshPendingUserOps]);

  const composerSendState = useMemo(
    () => deriveComposerSendState(findLastVisibleMessageDto(messages)),
    [messages],
  );

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);

  useEffect(() => {
    return onWorkspaceMutated(payload => {
      if (payload.sessionId === sessionId) {
        void refreshPendingUserOps();
      }
    });
  }, [sessionId, refreshPendingUserOps]);

  // 切换会话：重置 UI 运行态；从 DB 水化 attach+text 并投影状态条
  useEffect(() => {
    resetUiForSessionChange();
    onStreamReset();
    setComposerError(undefined);
    setHasPendingUserOps(false);
    composerDraftHydratedRef.current = false;
    setComposerText('');
    setComposerAttachments([]);

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
      setComposerAttachments(
        replaceComposerStatusAttachments(draft.attachments, status),
      );
      composerDraftHydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, resetUiForSessionChange, onStreamReset]);

  // 水化完成后：仅持久 attach+text（状态条不进列）
  useEffect(() => {
    if (!composerDraftHydratedRef.current) {
      return;
    }
    const draftJson = serializeComposerDraftJson({
      text: composerText,
      attachments: composerAttachments,
    });
    void ipcSessionsSetComposerDraft({ sessionId, draftJson });
  }, [sessionId, composerText, composerAttachments]);

  useEffect(() => {
    ipcAppUiGet('chatRichText')
      .then(res =>
        setChatRichText(
          res.ok && res.data != null ? res.data !== 'false' : true,
        ),
      )
      .catch(() => undefined);
  }, []);

  const onTextDelta = useCallback(
    (delta: string) => {
      if (!shouldAcceptStreamIngress(getUiRunning())) {
        return;
      }
      if (delta.length === 0) {
        return;
      }
      noteMetricsTextDelta(delta);
      setStreamingText(prev => {
        const next = prev + delta;
        streamingTextRef.current = next;
        return next;
      });
    },
    [getUiRunning, noteMetricsTextDelta],
  );

  const onThinkingDelta = useCallback(
    (delta: string) => {
      if (!shouldAcceptStreamIngress(getUiRunning())) {
        return;
      }
      noteMetricsThinkingDelta(delta);
      setStreamingThinking(prev => prev + delta);
    },
    [getUiRunning, noteMetricsThinkingDelta],
  );

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
      streamingTextRef.current = '';
      setStreamingText('');
      setStreamingThinking('');
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
    ],
  );

  useAgentStream({
    sessionId,
    acceptRunEvent,
    onTextDelta,
    onThinkingDelta,
    onRunStarted,
    onStepCommitted,
    onRunFinished,
    onRunFailed,
  });

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
      streamingTextRef.current = '';
      setStreamingText('');
      await reloadMessages();
      if (!options?.skipVfsReconcile) {
        notifyWorkspaceMutated();
      }
      setComposerText(prevText => {
        const next = resolveComposerDraftAfterRollbackSuccess(
          { text: prevText, attachments: composerAttachments },
          rollbackMode,
          { text: restoreText, attachments: restoreAttachments },
        );
        setComposerAttachments([...next.attachments]);
        return next.text;
      });
      showToast(
        options?.skipVfsReconcile ? '对话已截断，工作区未恢复' : '回滚成功',
      );
    },
    [
      projectId,
      sessionId,
      reloadMessages,
      notifyWorkspaceMutated,
      composerAttachments,
    ],
  );

  const handleMessageAction = useCallback(
    async (message: ChatMessageDto, action: string) => {
      if (action === 'edit') {
        const initial = editableTextFromMessage(message);
        if (initial == null) {
          showToast('该消息没有可编辑的文本');
          return;
        }
        // T-TX2：编辑回填 Composer 原文 + attachments chips
        setComposerText(initial);
        setComposerAttachments([...(message.attachments ?? [])]);
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
        streamingTextRef.current = '';
        setStreamingText('');
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
            uiRunning={running}
            streamingText={running ? streamingText : undefined}
            streamingThinking={running ? streamingThinking : undefined}
            streamTailGenerating={running}
            agentRunning={agentActive}
            chatRichText={chatRichText}
            onOpenMessageMenu={openMessageMenu}
            onOpenToolFile={openChatWorkspacePreview}
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
        <ChatComposer
          projectId={projectId}
          sessionId={sessionId}
          value={composerText}
          onChange={setComposerText}
          attachments={composerAttachments}
          onAttachmentsChange={setComposerAttachments}
          running={running}
          canResumeWithoutInput={composerSendState.canResumeWithoutInput}
          hasPendingUserOps={hasPendingUserOps}
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

/** 手动压缩：ok 收尾 Toast；上条清空由 main 投影推送 COMPOSER_ATTACHMENTS_SUGGEST。 */
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
}
