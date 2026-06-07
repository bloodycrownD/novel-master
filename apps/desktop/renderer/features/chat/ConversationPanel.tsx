import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessageDto } from "../../../shared/ipc-types";
import { useAgentStream } from "../../hooks/useAgentStream";
import {
  ipcAppUiGet,
  ipcCompactionManual,
  ipcMessagesDelete,
  ipcMessagesEdit,
  ipcMessagesFork,
  ipcMessagesHide,
  ipcMessagesList,
  ipcMessagesRollback,
  ipcMessagesShow,
} from "../../ipc/client";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import { useShellNav } from "../../providers/ShellNavProvider";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { showToast } from "../../components/ui/show-toast";
import { ChatComposer } from "./ChatComposer";
import {
  buildMessageActionItems,
  editableTextFromMessage,
} from "./message-edit";
import { MessageEditModal } from "./MessageEditModal";
import { MessageList } from "./MessageList";
import { RealPromptPanel } from "./RealPromptPanel";

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
  const [streamingText, setStreamingText] = useState("");
  const [chatRichText, setChatRichText] = useState(false);
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
    | { kind: "batch-delete"; count: number }
    | { kind: "rollback"; messageId: string }
    | { kind: "delete-message"; messageId: string }
    | null
  >(null);

  const reloadMessages = useCallback(async () => {
    const result = await ipcMessagesList({ sessionId });
    if (result.ok) {
      setMessages(result.data);
    }
  }, [sessionId]);

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);

  useEffect(() => {
    ipcAppUiGet("chatRichText")
      .then((res) => setChatRichText(res.value === "true"))
      .catch(() => undefined);
  }, []);

  const onTextDelta = useCallback((delta: string) => {
    setStreamingText((prev) => prev + delta);
  }, []);

  const onStreamReset = useCallback(() => {
    setStreamingText("");
  }, []);

  const onStepOrFinish = useCallback(() => {
    setStreamingText("");
    void reloadMessages();
  }, [reloadMessages]);

  useAgentStream({
    sessionId,
    onTextDelta,
    onThinkingDelta: () => undefined,
    onStepCommitted: onStepOrFinish,
    onRunFinished: () => {
      setRunning(false);
      onStepOrFinish();
    },
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

  const batchDelete = () => {
    if (messageBatch.selectedCount === 0) return;
    setConfirmState({ kind: "batch-delete", count: messageBatch.selectedCount });
  };

  const runBatchDelete = async () => {
    for (const id of messageBatch.selectedIds) {
      await ipcMessagesDelete({ messageId: id });
    }
    messageBatch.exit();
    await reloadMessages();
  };

  const batchHide = async () => {
    const ids = [...messageBatch.selectedIds];
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      await ipcMessagesHide({ messageId: id });
    }
    messageBatch.exit();
    await reloadMessages();
  };

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
          showToast("该消息包含工具调用，暂不支持编辑");
          return;
        }
        setMessageEdit({ messageId: message.id, initialText: initial });
        return;
      }
      if (action === "hide") {
        await ipcMessagesHide({ messageId: message.id });
        await reloadMessages();
        return;
      }
      if (action === "unhide") {
        await ipcMessagesShow({ messageId: message.id });
        await reloadMessages();
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
        return;
      }
      if (action === "delete") {
        setConfirmState({ kind: "delete-message", messageId: message.id });
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

  const deleteSingleMessage = useCallback(
    async (messageId: string) => {
      await ipcMessagesDelete({ messageId });
      setStreamingText("");
      await reloadMessages();
    },
    [reloadMessages],
  );

  const handleConfirm = useCallback(async () => {
    const state = confirmState;
    setConfirmState(null);
    if (!state) return;
    if (state.kind === "batch-delete") await runBatchDelete();
    else if (state.kind === "rollback") await executeRollback(state.messageId);
    else if (state.kind === "delete-message") await deleteSingleMessage(state.messageId);
  }, [confirmState, runBatchDelete, executeRollback, deleteSingleMessage]);

  const confirmMessage = (() => {
    if (!confirmState) return "";
    if (confirmState.kind === "batch-delete") {
      return `确定删除选中的 ${confirmState.count} 条消息？`;
    }
    if (confirmState.kind === "rollback") {
      return "将删除此消息之后的对话，并撤销相关文件修改。是否继续？";
    }
    return "确定删除这条消息？";
  })();

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
        <div
          className={`chat-messages${messageBatch.active ? " chat-messages--batch" : ""}`}
          id="chat-messages"
        >
          <MessageList
            messages={messages}
            streamingText={running ? streamingText : undefined}
            batchMode={messageBatch.active}
            selectedIds={messageBatch.selectedIds}
            chatRichText={chatRichText}
            onToggleSelect={messageBatch.toggle}
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
          <span id="chat-batch-count">
            已选 {messageBatch.selectedCount} 项
          </span>
          <button type="button" data-action="batch-delete" onClick={() => void batchDelete()}>
            删除
          </button>
          <button type="button" data-action="batch-hide" onClick={() => void batchHide()}>
            隐藏
          </button>
          <button type="button" onClick={messageBatch.exit}>
            取消
          </button>
        </div>
        {!messageBatch.active ? (
          <ChatComposer
            projectId={projectId}
            sessionId={sessionId}
            running={running}
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
        danger={
          confirmState?.kind === "batch-delete" ||
          confirmState?.kind === "delete-message"
        }
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
  enterBatch: () => void,
): Promise<void> {
  if (action === "batch-ops") {
    enterBatch();
  }
}

export async function runCompaction(
  projectId: string,
  sessionId: string,
): Promise<void> {
  await ipcCompactionManual({ projectId, sessionId });
}
