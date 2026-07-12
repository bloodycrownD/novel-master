import { formatRollbackRevisionBackfillAlertMessage } from '@novel-master/core/session-fs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessageDto } from '@shared/ipc-types';
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
} from '@/ipc/client';
import { useShellNav } from '@/providers/ShellNavProvider';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { showToast } from '@/components/ui/show-toast';
import { formatUserError } from '@/utils/format-user-error';
import { ChatComposer } from './ChatComposer';
import {
  deriveComposerSendState,
  findLastVisibleMessageDto,
} from './composer-send-state';
import {
  buildMessageActionItems,
  editableTextFromMessage,
} from './message-edit';
import { MessageEditModal } from './MessageEditModal';
import { flushAgentStepUi } from './flush-run-ui';
import { MessageList } from './MessageList';
import { RealPromptPanel } from './RealPromptPanel';
import { AgentStreamMetricsBar } from './AgentStreamMetricsBar';

interface ConversationPanelProps {
  projectId: string;
  sessionId: string;
  onOpenSessionActions: (anchor: HTMLElement) => void;
}

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
  const streamResetRef = useRef<() => void>(() => {});
  const [tab, setTab] = useState<'chat' | 'realPrompt'>('chat');
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');

  const runLifecycle = useAgentRunLifecycle(() => streamResetRef.current());
  const {
    uiRunning: running,
    acceptRunEvent,
    beginUiRun,
    abortUiRun: abortUiRunBase,
    getUiRunning,
    getTranscriptFreezeCount,
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
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  useEffect(() => {
    streamResetRef.current = onStreamReset;
  }, [onStreamReset]);

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
  const [confirmState, setConfirmState] = useState<
    | { kind: 'set-floor'; messageId: string }
    | { kind: 'rollback'; messageId: string }
    | {
        kind: 'rollback-backfill';
        messageId: string;
        missingLogicalPaths: readonly string[];
      }
    | { kind: 'rollback-degraded'; messageId: string; errorMessage: string }
    | null
  >(null);

  const reloadMessages = useCallback(async () => {
    const result = await ipcMessagesList({ sessionId });
    if (result.ok) {
      setMessages(result.data);
    }
  }, [sessionId]);

  const composerSendState = useMemo(
    () => deriveComposerSendState(findLastVisibleMessageDto(messages)),
    [messages],
  );

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);

  // 切换会话时重置 UI 运行态
  useEffect(() => {
    resetUiForSessionChange();
    onStreamReset();
    setComposerError(undefined);
  }, [sessionId, resetUiForSessionChange, onStreamReset]);

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
      if (!getUiRunning()) {
        return;
      }
      if (delta.length === 0) {
        return;
      }
      noteMetricsTextDelta(delta);
      setStreamingText(prev => prev + delta);
    },
    [getUiRunning, noteMetricsTextDelta],
  );

  const onThinkingDelta = useCallback(
    (delta: string) => {
      if (!getUiRunning()) {
        return;
      }
      noteMetricsThinkingDelta(delta);
      setStreamingThinking(prev => prev + delta);
    },
    [getUiRunning, noteMetricsThinkingDelta],
  );

  const onStepCommitted = useCallback(
    (payload: AgentStepCommittedPayload) => {
      const shouldReload = shouldApplyTranscriptReload(
        getUiRunning(),
        getTranscriptFreezeCount(),
      );
      if (shouldReload) {
        void flushAgentStepUi(payload.phase, reloadMessages, onStreamReset);
      }
      // Desktop-only 实时消费方 ①：Agent 工具突变后立即刷新 Explorer
      if (payload.vfsMutated) {
        vfsMutatedInRunRef.current = true;
        notifyWorkspaceMutated();
      }
    },
    [
      reloadMessages,
      onStreamReset,
      notifyWorkspaceMutated,
      getUiRunning,
      getTranscriptFreezeCount,
    ],
  );

  const onRunFinished = useCallback(
    (payload: AgentRunFinishedPayload) => {
      const shouldReload = shouldApplyTranscriptReload(
        getUiRunning(),
        getTranscriptFreezeCount(),
      );
      if (!finishUiRun(payload)) {
        return;
      }
      setStreamingText('');
      setStreamingThinking('');
      if (payload.vfsMutated) {
        notifyWorkspaceMutated();
      }
      vfsMutatedInRunRef.current = false;
      if (shouldReload) {
        void reloadMessages();
      }
    },
    [
      finishUiRun,
      reloadMessages,
      notifyWorkspaceMutated,
      getUiRunning,
      getTranscriptFreezeCount,
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

  const rollbackToMessage = useCallback(
    async (messageId: string) => {
      if (running) {
        showToast('Agent 运行中无法回滚');
        return;
      }
      setConfirmState({ kind: 'rollback', messageId });
    },
    [running],
  );

  const executeRollback = useCallback(
    async (
      messageId: string,
      options?: {
        skipVfsReconcile?: boolean;
        revisionHeadBackfill?: boolean;
      },
    ) => {
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
          });
          return;
        }
        if (result.error.code === 'ROLLBACK_VFS_RESTORE_FAILED') {
          setConfirmState({
            kind: 'rollback-degraded',
            messageId,
            errorMessage: result.error.message,
          });
          return;
        }
        showToast(result.error.message);
        return;
      }
      setStreamingText('');
      await reloadMessages();
      if (!options?.skipVfsReconcile) {
        notifyWorkspaceMutated();
      }
      showToast(
        options?.skipVfsReconcile ? '对话已截断，工作区未恢复' : '回滚成功',
      );
    },
    [projectId, sessionId, reloadMessages, notifyWorkspaceMutated],
  );

  const handleMessageAction = useCallback(
    async (message: ChatMessageDto, action: string) => {
      if (action === 'edit') {
        const initial = editableTextFromMessage(message);
        if (initial == null) {
          showToast('该消息没有可编辑的文本');
          return;
        }
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
      await executeRollback(state.messageId);
    } else if (state.kind === 'rollback-backfill') {
      await executeRollback(state.messageId, { revisionHeadBackfill: true });
    } else if (state.kind === 'rollback-degraded') {
      await executeRollback(state.messageId, { skipVfsReconcile: true });
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
      return `${confirmState.errorMessage}\n\n可仅删除此消息之后的对话，工作区文件将保持现状。`;
    }
    if (confirmState.kind === 'rollback-backfill') {
      return formatRollbackRevisionBackfillAlertMessage(
        confirmState.missingLogicalPaths,
      );
    }
    return '将删除此消息之后的对话，并撤销相关文件修改。是否继续？';
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

export async function runCompaction(
  projectId: string,
  sessionId: string,
): Promise<void> {
  await ipcCompactionManual({ projectId, sessionId });
}
