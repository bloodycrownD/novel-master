import type { ChatMessageDto } from "../../../shared/ipc-types";

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
  onToggleSelect?: (messageId: string) => void;
}

export function MessageList({
  messages,
  streamingText,
  batchMode = false,
  selectedIds,
  onToggleSelect,
}: MessageListProps) {
  if (messages.length === 0 && !streamingText) {
    return <p className="chat-messages__empty">暂无消息</p>;
  }

  return (
    <>
      {messages.map((msg) => {
        const selected = selectedIds?.has(msg.id) ?? false;
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
              </span>
              <p>{msg.bodyText}</p>
            </div>
          </div>
        );
      })}
      {streamingText ? (
        <div className="chat-message chat-message--assistant chat-message--streaming">
          <div className="chat-message__body">
            <span className="chat-message__role">助手</span>
            <p>{streamingText}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
