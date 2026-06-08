import Markdown from "react-markdown";
import type { ChatMessageDto } from "../../../shared/ipc-types";
import { buildChatListItems } from "./message-blocks";
import { ToolCallGroupCard } from "./ToolCallGroupCard";

const ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
};

interface MessageListProps {
  messages: readonly ChatMessageDto[];
  streamingText?: string;
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
}: {
  text: string;
  richText: boolean;
}) {
  if (richText) {
    return (
      <div className="chat-message__markdown">
        <Markdown>{text}</Markdown>
      </div>
    );
  }
  return <p>{text}</p>;
}

export function MessageList({
  messages,
  streamingText,
  batchMode = false,
  selectedIds,
  chatRichText = false,
  onToggleSelect,
  onOpenMessageMenu,
}: MessageListProps) {
  if (messages.length === 0 && !streamingText) {
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
              {item.tools.length > 0 ? (
                <ToolCallGroupCard tools={item.tools} dimmed={msg.hidden} />
              ) : null}
              {text ? (
                <MessageBody text={text} richText={chatRichText} />
              ) : null}
            </div>
          </div>
        );
      })}
      {streamingText ? (
        <div className="chat-message chat-message--assistant chat-message--streaming">
          <div className="chat-message__body">
            <span className="chat-message__role">助手</span>
            {chatRichText ? (
              <div className="chat-message__markdown">
                <Markdown>{streamingText}</Markdown>
              </div>
            ) : (
              <p>{streamingText}</p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
