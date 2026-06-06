import { useCallback, useEffect, useState } from "react";
import type { ChatMessageDto } from "../../../shared/ipc-types";
import { useAgentStream } from "../../hooks/useAgentStream";
import {
  ipcCompactionManual,
  ipcMessagesDelete,
  ipcMessagesHide,
  ipcMessagesList,
  ipcMessagesRollback,
} from "../../ipc/client";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import { useShellNav } from "../../providers/ShellNavProvider";
import { ChatComposer } from "./ChatComposer";
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
  const { refreshWorkspaceTrees } = useShellNav();
  const [tab, setTab] = useState<"chat" | "realPrompt">("chat");
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [running, setRunning] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [messageMenu, setMessageMenu] = useState<{
    message: ChatMessageDto;
    x: number;
    y: number;
  } | null>(null);

  const reloadMessages = useCallback(async () => {
    const result = await ipcMessagesList({ sessionId });
    if (result.ok) {
      setMessages(result.data);
    }
  }, [sessionId]);

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);

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

  const batchDelete = async () => {
    const ids = [...messageBatch.selectedIds];
    if (ids.length === 0) {
      return;
    }
    if (!window.confirm(`确定删除选中的 ${ids.length} 条消息？`)) {
      return;
    }
    for (const id of ids) {
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
        y: Math.max(8, Math.min(position.y, window.innerHeight - 120)),
      });
    },
    [],
  );

  const copyMessage = useCallback(async (message: ChatMessageDto) => {
    const text = message.bodyText?.trim();
    if (!text) {
      window.alert("该消息没有可复制的文本");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.alert("复制失败");
    }
  }, []);

  const rollbackToMessage = useCallback(
    async (messageId: string) => {
      if (running) {
        window.alert("Agent 运行中无法回滚");
        return;
      }
      if (
        !window.confirm(
          "将删除此消息之后的对话，并撤销相关文件修改。是否继续？",
        )
      ) {
        return;
      }
      const result = await ipcMessagesRollback({
        projectId,
        sessionId,
        messageId,
      });
      if (!result.ok) {
        window.alert(result.error.message);
        return;
      }
      setStreamingText("");
      await reloadMessages();
      refreshWorkspaceTrees();
    },
    [running, projectId, sessionId, reloadMessages, refreshWorkspaceTrees],
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
        <div
          className={`chat-messages${messageBatch.active ? " chat-messages--batch" : ""}`}
          id="chat-messages"
        >
          <MessageList
            messages={messages}
            streamingText={running ? streamingText : undefined}
            batchMode={messageBatch.active}
            selectedIds={messageBatch.selectedIds}
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
          <button
            type="button"
            data-message-action="copy"
            onClick={() => {
              const target = messageMenu?.message;
              closeMessageMenu();
              if (target) {
                void copyMessage(target);
              }
            }}
          >
            复制
          </button>
          <button
            type="button"
            data-message-action="rollback"
            className="is-danger"
            onClick={() => {
              const target = messageMenu?.message;
              closeMessageMenu();
              if (target) {
                void rollbackToMessage(target.id);
              }
            }}
          >
            回滚到此
          </button>
        </div>
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
    </>
  );
}

export async function runSessionAction(
  action: string,
  projectId: string,
  sessionId: string,
  enterBatch: () => void,
): Promise<void> {
  if (action === "batch-ops") {
    enterBatch();
    return;
  }
  if (action === "compact-chat") {
    if (!window.confirm("将按照事件配置压缩上下文。是否继续？")) {
      return;
    }
    await ipcCompactionManual({ projectId, sessionId });
  }
}
