import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessageDto } from "../../../shared/ipc-types";
import { buildChatListItems } from "./message-blocks";
import { ToolCallGroupCard } from "./ToolCallGroupCard";

const ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
};

import type { ToolCallView } from "./message-blocks";

interface MessageListProps {
  messages: readonly ChatMessageDto[];
  streamingText?: string;
  streamingThinking?: string;
  streamingTools?: readonly ToolCallView[];
  batchMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  chatRichText?: boolean;
  onToggleSelect?: (messageId: string) => void;
  onOpenMessageMenu?: (
    message: ChatMessageDto,
    position: { x: number; y: number },
  ) => void;
}

function MessageBody({
  text,
  richText,
  alwaysRichText = false,
}: {
  text: string;
  richText: boolean;
  alwaysRichText?: boolean;
}) {
  if (richText || alwaysRichText) {
    return (
      <div className="chat-message__markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
      </div>
    );
  }
  return <p>{text}</p>;
}

export function MessageList({
  messages,
  streamingText,
  streamingThinking,
  streamingTools = [],
  batchMode = false,
  selectedIds,
  chatRichText = false,
  onToggleSelect,
  onOpenMessageMenu,
}: MessageListProps) {
  const hasStreaming =
    !!streamingText ||
    !!streamingThinking ||
    streamingTools.length > 0;

  if (messages.length === 0 && !hasStreaming) {
    return <p className="chat-messages__empty">暂无消息</p>;
  }

  const openMenu = (
    message: ChatMessageDto,
    event: React.MouseEvent | MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenMessageMenu?.(message, { x: event.clientX, y: event.clientY });
  };

  const listItems = buildChatListItems(messages);

  return (
    <>
      {listItems.map((item) => {
        const msg = item.message;
        const selected = selectedIds?.has(msg.id) ?? false;
        const text = item.textParts.join("\n");

        return (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}${msg.hidden ? " chat-message--hidden" : ""}${batchMode ? " chat-message--batch" : ""}${selected ? " is-selected" : ""}`}
            data-message-id={msg.id}
            onClick={() => {
              if (batchMode) {
                onToggleSelect?.(msg.id);
              }
            }}
            onContextMenu={(e) => {
              if (batchMode || !onOpenMessageMenu) {
                return;
              }
              openMenu(msg, e);
            }}
          >
            {batchMode ? (
              <label className="chat-message__check" aria-label="选择消息">
                <input type="checkbox" checked={selected} readOnly />
              </label>
            ) : null}
            <div className="chat-message__body">
              <span className="chat-message__role">
                {ROLE_LABELS[msg.role] ?? msg.role}
                {msg.hidden ? (
                  <span className="chat-message__hidden-tag">已隐藏</span>
                ) : null}
                {!batchMode && onOpenMessageMenu ? (
                  <button
                    type="button"
                    className="chat-message__menu-btn"
                    aria-label="消息操作"
                    aria-haspopup="menu"
                    onClick={(e) => openMenu(msg, e)}
                  >
                    ⋯
                  </button>
                ) : null}
              </span>
              {item.thinkingParts.length > 0 ? (
                <details className="chat-message__thinking">
                  <summary>思考过程</summary>
                  <p>{item.thinkingParts.join("\n")}</p>
                </details>
              ) : null}
              {text ? (
                <MessageBody
                  text={text}
                  richText={chatRichText}
                  alwaysRichText={msg.role === "assistant"}
                />
              ) : null}
              {item.tools.length > 0 ? (
                <ToolCallGroupCard tools={item.tools} dimmed={msg.hidden} />
              ) : null}
            </div>
          </div>
        );
      })}
      {hasStreaming ? (
        <div className="chat-message chat-message--assistant chat-message--streaming">
          <div className="chat-message__body">
            <span className="chat-message__role">助手</span>
            {streamingThinking ? (
              <details className="chat-message__thinking" open>
                <summary>思考过程</summary>
                <p>{streamingThinking}</p>
              </details>
            ) : null}
            {streamingText ? (
              <div className="chat-message__markdown">
                <Markdown remarkPlugins={[remarkGfm]}>{streamingText}</Markdown>
              </div>
            ) : null}
            {streamingTools.length > 0 ? (
              <ToolCallGroupCard tools={streamingTools} />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
