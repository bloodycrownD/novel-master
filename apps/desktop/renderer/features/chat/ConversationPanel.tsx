import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessageDto } from "@shared/ipc-types";
import type {
  AgentRunFailedPayload,
  AgentRunFinishedPayload,
  AgentStepCommittedPayload,
} from "@shared/agent-event-types";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useAgentStreamMetrics } from "@/hooks/useAgentStreamMetrics";
import { useStreamToolInvoking } from "@/hooks/useStreamToolInvoking";
import {
  ipcAppUiGet,
  ipcCompactionManual,
  ipcMessagesEdit,
  ipcMessagesFork,
  ipcMessagesHideRange,
  ipcMessagesList,
  ipcMessagesRollback,
  ipcMessagesShowRange,
} from "@/ipc/client";
import { useBatchSelection } from "@/hooks/useBatchSelection";
import { useShellNav } from "@/providers/ShellNavProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { showToast } from "@/components/ui/show-toast";
import { ChatComposer } from "./ChatComposer";
import {
  deriveComposerSendState,
  findLastVisibleMessageDto,
} from "./composer-send-state";
import {
  buildMessageActionItems,
  editableTextFromMessage,
} from "./message-edit";
import { MessageEditModal } from "./MessageEditModal";
import { flushAgentStepUi } from "./flush-run-ui";
import { MessageList } from "./MessageList";
import { RealPromptPanel } from "./RealPromptPanel";
import { AgentStreamMetricsBar } from "./AgentStreamMetricsBar";
import {
  computeHideRangeFromSelection,
  computeShowRangeFromSelection,
  computeVisibilityBatchAffectedIds,
  isTranscriptRowSelectable,
  selectVisibilityBatchEligibleIdsFromAnchor,
  transcriptSelectableRole,
} from "./transcript-selectable-role";

interface ConversationPanelProps {
  projectId: string;
  sessionId: string;
  onOpenSessionActions: (anchor: HTMLElement) => void;
  messageBatch: ReturnType<typeof useBatchSelection>;
}

export function ConversationPanel({
  projectId,
  sessionId,
  onOpenSessionActions,
  messageBatch,
}: ConversationPanelProps) {
  const { refreshWorkspaceTrees, openSession, projectName } = useShellNav();
  const [tab, setTab] = useState<"chat" | "realPrompt">("chat");
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [running, setRunning] = useState(false);
  const {
    toolInvoking,
    noteTextDelta: noteInvokingTextDelta,
    noteThinkingDelta: noteInvokingThinkingDelta,
    reset: resetToolInvoking,
  } = useStreamToolInvoking(running);
  const {
    metrics: streamMetrics,
    noteTextDelta: noteMetricsTextDelta,
    noteThinkingDelta: noteMetricsThinkingDelta,
  } = useAgentStreamMetrics(running);
  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
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
    | { kind: "hide-messages"; toSeq: number }
    | { kind: "restore-messages"; fromSeq: number; toSeq: number }
    | { kind: "rollback"; messageId: string }
    | null
  >(null);

  const reloadMessages = useCallback(async () => {
    const result = await ipcMessagesList({ sessionId });
    if (result.ok) {
      setMessages(result.data);
    }
  }, [sessionId]);

  const sessionMaxSeq = useMemo(
    () =>
      messages.length > 0
        ? Math.max(...messages.map((m) => m.seq))
        : 0,
    [messages],
  );

  const visibilityBatchPreview = useMemo(() => {
    if (messageBatch.mode == null) {
      return {
        affectedIds: new Set<string>() as ReadonlySet<string>,
        affectedCount: 0,
        rangeLabel: null as string | null,
      };
    }
    const affectedIds = computeVisibilityBatchAffectedIds(
      messages,
      messageBatch.mode,
      messageBatch.selectedIds,
      sessionMaxSeq,
    );
    if (affectedIds.size === 0) {
      return { affectedIds, affectedCount: 0, rangeLabel: null };
    }
    if (messageBatch.mode === "hide") {
      const range = computeHideRangeFromSelection(
        messages,
        messageBatch.selectedIds,
      );
      return {
        affectedIds,
        affectedCount: affectedIds.size,
        rangeLabel: range != null ? `seq 1–${range.toSeq}` : null,
      };
    }
    const range = computeShowRangeFromSelection(
      messages,
      messageBatch.selectedIds,
      sessionMaxSeq,
    );
    return {
      affectedIds,
      affectedCount: affectedIds.size,
      rangeLabel: range != null ? `seq ${range.fromSeq}–末` : null,
    };
  }, [messages, messageBatch.mode, messageBatch.selectedIds, sessionMaxSeq]);

  const composerSendState = useMemo(
    () => deriveComposerSendState(findLastVisibleMessageDto(messages)),
    [messages],
  );

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);

  useEffect(() => {
    ipcAppUiGet("chatRichText")
      .then((res) =>
        setChatRichText(
          res.ok && res.data != null ? res.data !== "false" : true,
        ),
      )
      .catch(() => undefined);
  }, []);

  const onTextDelta = useCallback((delta: string) => {
    noteInvokingTextDelta(delta);
    noteMetricsTextDelta(delta);
    setStreamingText((prev) => prev + delta);
  }, [noteInvokingTextDelta, noteMetricsTextDelta]);

  const onThinkingDelta = useCallback((delta: string) => {
    noteInvokingThinkingDelta(delta);
    noteMetricsThinkingDelta(delta);
    setStreamingThinking((prev) => prev + delta);
  }, [noteInvokingThinkingDelta, noteMetricsThinkingDelta]);

  const onStreamReset = useCallback(() => {
    resetToolInvoking();
    setStreamingText("");
    setStreamingThinking("");
  }, [resetToolInvoking]);

  const onStepCommitted = useCallback(
    (payload: AgentStepCommittedPayload) => {
      void flushAgentStepUi(payload.phase, reloadMessages, onStreamReset);
      if (payload.phase === "tool_results" && payload.vfsMutated === true) {
        refreshWorkspaceTrees();
      }
    },
    [reloadMessages, refreshWorkspaceTrees, onStreamReset],
  );

  const onRunFinished = useCallback(
    (payload: AgentRunFinishedPayload) => {
      setRunning(false);
      setStreamingText("");
      setStreamingThinking("");
      void reloadMessages();
      if (payload.vfsMutated === true) {
        refreshWorkspaceTrees();
      }
    },
    [reloadMessages, refreshWorkspaceTrees],
  );

  const onRunFailed = useCallback(
    (payload: AgentRunFailedPayload) => {
      setRunning(false);
      setStreamingText("");
      setStreamingThinking("");
      showToast(payload.error);
      void reloadMessages();
    },
    [reloadMessages],
  );

  useAgentStream({
    sessionId,
    onTextDelta,
    onThinkingDelta,
    onStepCommitted,
    onRunFinished,
    onRunFailed,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest("[data-action='open-session-actions']");
      if (btn instanceof HTMLElement) {
        onOpenSessionActions(btn);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onOpenSessionActions]);

  const requestBatchConfirm = useCallback(() => {
    if (messageBatch.selectedCount === 0 || messageBatch.mode == null) {
      return;
    }
    if (messageBatch.mode === "hide") {
      const range = computeHideRangeFromSelection(
        messages,
        messageBatch.selectedIds,
      );
      if (range == null) {
        return;
      }
      setConfirmState({ kind: "hide-messages", toSeq: range.toSeq });
      return;
    }
    const range = computeShowRangeFromSelection(
      messages,
      messageBatch.selectedIds,
      sessionMaxSeq,
    );
    if (range == null) {
      return;
    }
    setConfirmState({
      kind: "restore-messages",
      fromSeq: range.fromSeq,
      toSeq: range.toSeq,
    });
  }, [messageBatch, messages, sessionMaxSeq]);

  const closeMessageMenu = useCallback(() => {
    setMessageMenu(null);
  }, []);

  useEffect(() => {
    const onDocClick = () => closeMessageMenu();
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
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
      showToast("该消息没有可复制的文本");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制");
    } catch {
      showToast("复制失败");
    }
  }, []);

  const rollbackToMessage = useCallback(
    async (messageId: string) => {
      if (running) {
        showToast("Agent 运行中无法回滚");
        return;
      }
      setConfirmState({ kind: "rollback", messageId });
    },
    [running],
  );

  const executeRollback = useCallback(
    async (messageId: string) => {
      const result = await ipcMessagesRollback({
        projectId,
        sessionId,
        messageId,
      });
      if (!result.ok) {
        showToast(result.error.message);
        return;
      }
      setStreamingText("");
      await reloadMessages();
      refreshWorkspaceTrees();
    },
    [projectId, sessionId, reloadMessages, refreshWorkspaceTrees],
  );

  const handleMessageAction = useCallback(
    async (message: ChatMessageDto, action: string) => {
      if (action === "edit") {
        const initial = editableTextFromMessage(message);
        if (initial == null) {
          showToast("该消息没有可编辑的文本");
          return;
        }
        setMessageEdit({ messageId: message.id, initialText: initial });
        return;
      }
      if (action === "copy") {
        await copyMessage(message);
        return;
      }
      if (action === "fork") {
        if (running) {
          showToast("Agent 运行中无法分叉");
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
        setStreamingText("");
        await openSession(result.data, projectName ?? "—");
        refreshWorkspaceTrees();
        return;
      }
      if (action === "rollback") {
        await rollbackToMessage(message.id);
      }
    },
    [
      running,
      sessionId,
      reloadMessages,
      copyMessage,
      rollbackToMessage,
      openSession,
      projectName,
      refreshWorkspaceTrees,
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
    if (state.kind === "rollback") {
      await executeRollback(state.messageId);
    } else {
      if (state.kind === "hide-messages") {
        const result = await ipcMessagesHideRange({
          sessionId,
          fromSeq: 1,
          toSeq: state.toSeq,
        });
        if (!result.ok) {
          showToast(result.error.message);
          return;
        }
      } else if (state.kind === "restore-messages") {
        const result = await ipcMessagesShowRange({
          sessionId,
          fromSeq: state.fromSeq,
          toSeq: state.toSeq,
        });
        if (!result.ok) {
          showToast(result.error.message);
          return;
        }
      }
      messageBatch.exit();
      await reloadMessages();
    }
  }, [confirmState, sessionId, messageBatch, executeRollback, reloadMessages]);

  const confirmMessage = (() => {
    if (!confirmState) return "";
    if (confirmState.kind === "hide-messages") {
      return `将隐藏所选 assistant 消息（seq ≤ ${confirmState.toSeq}）及其之前的所有消息。是否继续？`;
    }
    if (confirmState.kind === "restore-messages") {
      return `将恢复所选 user 消息（seq ≥ ${confirmState.fromSeq}）及其之后的所有消息。是否继续？`;
    }
    return "将删除此消息之后的对话，并撤销相关文件修改。是否继续？";
  })();

  const batchBarTitle =
    messageBatch.mode === "hide"
      ? "隐藏消息"
      : messageBatch.mode === "restore"
        ? "恢复消息"
        : "";

  const batchBarSummary =
    visibilityBatchPreview.affectedCount > 0 &&
    visibilityBatchPreview.rangeLabel != null
      ? `${batchBarTitle} · 将影响 ${visibilityBatchPreview.affectedCount} 条（${visibilityBatchPreview.rangeLabel}）`
      : batchBarTitle;

  const batchHint =
    messageBatch.mode === "hide"
      ? "点击 assistant 将重置并勾选其上界以内全部 assistant"
      : messageBatch.mode === "restore"
        ? "点击 user 将重置并勾选其下界及之后全部 user"
        : "";

  const handleToggleSelect = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (msg == null || messageBatch.mode == null) {
        return;
      }
      const role = transcriptSelectableRole(msg.role, messageBatch.mode);
      if (!isTranscriptRowSelectable(role)) {
        return;
      }
      const nextIds = selectVisibilityBatchEligibleIdsFromAnchor(
        messages,
        messageBatch.mode,
        messageId,
      );
      messageBatch.selectRange(nextIds);
    },
    [messages, messageBatch],
  );

  return (
    <>
      <div className="conversation-tabs" role="tablist" aria-label="会话内容">
        <button
          type="button"
          className={`conversation-tab${tab === "chat" ? " is-active" : ""}`}
          data-conversation-tab="chat"
          role="tab"
          aria-selected={tab === "chat"}
          onClick={() => setTab("chat")}
        >
          聊天
        </button>
        <button
          type="button"
          className={`conversation-tab${tab === "realPrompt" ? " is-active" : ""}`}
          data-conversation-tab="realPrompt"
          role="tab"
          aria-selected={tab === "realPrompt"}
          onClick={() => setTab("realPrompt")}
        >
          提示词
        </button>
      </div>
      <div
        className={`conversation-panel${tab === "chat" ? " is-visible" : ""}`}
        data-conversation-panel="chat"
        hidden={tab !== "chat"}
      >
        {streamMetrics != null ? (
          <AgentStreamMetricsBar metrics={streamMetrics} />
        ) : null}
        <div
          className={`chat-messages${messageBatch.active ? " chat-messages--batch" : ""}`}
          id="chat-messages"
        >
          <MessageList
            messages={messages}
            streamingText={running ? streamingText : undefined}
            streamingThinking={running ? streamingThinking : undefined}
            toolInvoking={running ? toolInvoking : false}
            agentRunning={running}
            batchMode={messageBatch.mode}
            selectedIds={messageBatch.selectedIds}
            affectedIds={visibilityBatchPreview.affectedIds}
            chatRichText={chatRichText}
            onToggleSelect={handleToggleSelect}
            onOpenMessageMenu={messageBatch.active ? undefined : openMessageMenu}
          />
        </div>
        <div
          id="message-actions-menu"
          className={`message-actions-menu${messageMenu ? "" : " hidden"}`}
          role="menu"
          aria-label="消息操作"
          hidden={!messageMenu}
          style={
            messageMenu
              ? { left: messageMenu.x, top: messageMenu.y }
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
        >
          {menuItems.map((item) => (
            <button
              key={item.action}
              type="button"
              data-message-action={item.action}
              className={item.danger ? "is-danger" : undefined}
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
          initialValue={messageEdit?.initialText ?? ""}
          onClose={() => setMessageEdit(null)}
          onConfirm={async (value) => {
            const edit = messageEdit;
            setMessageEdit(null);
            if (edit) {
              await saveMessageEdit(edit.messageId, value);
            }
          }}
        />
        <div
          id="chat-batch-bar"
          className={`chat-batch-bar${messageBatch.active ? "" : " hidden"}`}
          hidden={!messageBatch.active}
        >
          <div className="chat-batch-bar__main">
            <button
              type="button"
              className="chat-batch-bar__cancel"
              onClick={messageBatch.exit}
            >
              取消
            </button>
            <div className="chat-batch-bar__info">
              <span id="chat-batch-count" className="chat-batch-bar__title">
                {batchBarSummary}
              </span>
              <span className="chat-batch-bar__hint">{batchHint}</span>
            </div>
            <div className="chat-batch-bar__actions">
              <button
                type="button"
                className="chat-batch-bar__btn chat-batch-bar__btn--primary"
                data-action="batch-confirm"
                disabled={messageBatch.selectedCount === 0}
                onClick={() => requestBatchConfirm()}
              >
                确认
              </button>
            </div>
          </div>
        </div>
        {!messageBatch.active ? (
          <ChatComposer
            projectId={projectId}
            sessionId={sessionId}
            running={running}
            canResumeWithoutInput={composerSendState.canResumeWithoutInput}
            lastMessageHasToolResult={composerSendState.lastMessageHasToolResult}
            lastMessageIsPlainUserText={
              composerSendState.lastMessageIsPlainUserText
            }
            onRunningChange={setRunning}
            onStreamReset={onStreamReset}
            onMessagesChanged={reloadMessages}
          />
        ) : null}
      </div>
      <div
        className={`conversation-panel${tab === "realPrompt" ? " is-visible" : ""}`}
        data-conversation-panel="realPrompt"
        hidden={tab !== "realPrompt"}
      >
        <RealPromptPanel
          projectId={projectId}
          sessionId={sessionId}
          visible={tab === "realPrompt"}
        />
      </div>
      <ConfirmModal
        open={confirmState != null}
        title="确认操作"
        message={confirmMessage}
        danger={confirmState?.kind === "rollback"}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </>
  );
}

export async function runSessionAction(
  action: string,
  _projectId: string,
  _sessionId: string,
  batch: ReturnType<typeof useBatchSelection>,
): Promise<void> {
  if (action === "hide-messages") {
    batch.enterHide();
  } else if (action === "restore-messages") {
    batch.enterRestore();
  }
}

export async function runCompaction(
  projectId: string,
  sessionId: string,
): Promise<void> {
  await ipcCompactionManual({ projectId, sessionId });
}
