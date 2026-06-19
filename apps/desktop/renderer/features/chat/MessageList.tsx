import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessageDto } from "@shared/ipc-types";
import { buildChatListItems } from "./message-blocks";
import { ToolCallGroupCard } from "./ToolCallGroupCard";
import {
  parseUserVfsActionFromText,
  UserVfsActionBody,
} from "./user-vfs-action-transcript";
import type { MessageVisibilityBatchMode } from "./transcript-selectable-role";
import {
  isTranscriptRowSelectable,
  transcriptSelectableRole,
} from "./transcript-selectable-role";

const ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
};

interface MessageListProps {
  messages: readonly ChatMessageDto[];
  streamingText?: string;
  streamingThinking?: string;
  toolInvoking?: boolean;
  agentRunning?: boolean;
  batchMode?: MessageVisibilityBatchMode | null;
  selectedIds?: ReadonlySet<string>;
  /** 范围预览：hide/restore 将影响的消息 id（含不可勾选行）。 */
  affectedIds?: ReadonlySet<string>;
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
  toolInvoking = false,
  agentRunning = false,
  batchMode = null,
  selectedIds,
  affectedIds,
  chatRichText = false,
  onToggleSelect,
  onOpenMessageMenu,
}: MessageListProps) {
  const hasStreaming = !!streamingText || !!streamingThinking || toolInvoking;

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

  const listItems = buildChatListItems(messages, { agentRunning });

  return (
    <>
      {listItems.map((item) => {
        if (item.kind === "user_vfs_turn") {
          if (item.tools.length === 0) {
            return null;
          }
          const selected = selectedIds?.has(item.id) ?? false;
          const inRange = affectedIds?.has(item.id) ?? false;
          const selectableRole = transcriptSelectableRole("user", batchMode);
          const rowSelectable = isTranscriptRowSelectable(selectableRole);

          return (
            <div
              key={item.id}
              className={`chat-message chat-message--user${item.hidden ? " chat-message--hidden" : ""}${batchMode ? " chat-message--batch" : ""}${selected ? " is-selected" : ""}${inRange ? " is-in-range" : ""}`}
              data-message-id={item.id}
              data-selectable-role={selectableRole}
              onClick={() => {
                if (batchMode && rowSelectable) {
                  onToggleSelect?.(item.id);
                }
              }}
            >
              {batchMode && rowSelectable ? (
                <label className="chat-message__check" aria-label="选择消息">
                  <input type="checkbox" checked={selected} readOnly />
                </label>
              ) : batchMode ? (
                <span className="chat-message__check-spacer" aria-hidden="true" />
              ) : null}
              <div className="chat-message__body">
                <span className="chat-message__role">
                  用户
                  {item.hidden ? (
                    <span className="chat-message__hidden-tag">已隐藏</span>
                  ) : null}
                </span>
                <ToolCallGroupCard tools={item.tools} dimmed={item.hidden} />
              </div>
            </div>
          );
        }

        const msg = item.message;
        const selected = selectedIds?.has(msg.id) ?? false;
        const inRange = affectedIds?.has(msg.id) ?? false;
        const text = item.textParts.join("\n");

        const selectableRole = transcriptSelectableRole(msg.role, batchMode);
        const rowSelectable = isTranscriptRowSelectable(selectableRole);
        const userVfsAction =
          msg.role === "user" ? parseUserVfsActionFromText(text) : null;

        return (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}${msg.hidden ? " chat-message--hidden" : ""}${batchMode ? " chat-message--batch" : ""}${selected ? " is-selected" : ""}${inRange ? " is-in-range" : ""}`}
            data-message-id={msg.id}
            data-selectable-role={selectableRole}
            onClick={() => {
              if (batchMode && rowSelectable) {
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
            {batchMode && rowSelectable ? (
              <label className="chat-message__check" aria-label="选择消息">
                <input type="checkbox" checked={selected} readOnly />
              </label>
            ) : batchMode ? (
              <span className="chat-message__check-spacer" aria-hidden="true" />
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
                userVfsAction != null ? (
                  <UserVfsActionBody action={userVfsAction} />
                ) : (
                  <MessageBody
                    text={text}
                    richText={chatRichText}
                    alwaysRichText={msg.role === "assistant"}
                  />
                )
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
            {toolInvoking ? (
              <p className="chat-message__tool-invoking">工具调用中</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
