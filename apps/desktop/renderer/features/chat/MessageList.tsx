import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessageDto } from "@shared/ipc-types";
import { buildChatListItems } from "./message-blocks";
import { ToolCallGroupCard } from "./ToolCallGroupCard";
import {
  parseUserVfsActionFromText,
  UserVfsActionBody,
} from "./user-vfs-action-transcript";

const ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
};

interface MessageListProps {
  messages: readonly ChatMessageDto[];
  uiRunning?: boolean;
  streamingText?: string;
  streamingThinking?: string;
  streamTailGenerating?: boolean;
  agentRunning?: boolean;
  chatRichText?: boolean;
  onOpenMessageMenu?: (
    message: ChatMessageDto,
    position: { x: number; y: number },
  ) => void;
  /** 点击文件类工具卡片时在聊天工作区 Preview 打开路径。 */
  onOpenToolFile?: (path: string) => void;
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
  uiRunning = false,
  streamingText,
  streamingThinking,
  streamTailGenerating: _streamTailGenerating = false,
  agentRunning = false,
  chatRichText = false,
  onOpenMessageMenu,
  onOpenToolFile,
}: MessageListProps) {
  const hasStreaming = uiRunning;

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

          return (
            <div
              key={item.id}
              className={`chat-message chat-message--user${item.hidden ? " chat-message--hidden" : ""}`}
              data-message-id={item.id}
            >
              <div className="chat-message__body">
                <span className="chat-message__role">
                  用户
                  {item.hidden ? (
                    <span className="chat-message__hidden-tag">已隐藏</span>
                  ) : null}
                </span>
                <ToolCallGroupCard
                  tools={item.tools}
                  dimmed={item.hidden}
                  onOpenFile={onOpenToolFile}
                />
              </div>
            </div>
          );
        }

        const msg = item.message;
        const text = item.textParts.join("\n");
        const userVfsAction =
          msg.role === "user" ? parseUserVfsActionFromText(text) : null;

        return (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}${msg.hidden ? " chat-message--hidden" : ""}`}
            data-message-id={msg.id}
            onContextMenu={(e) => {
              if (!onOpenMessageMenu) {
                return;
              }
              openMenu(msg, e);
            }}
          >
            <div className="chat-message__body">
              <span className="chat-message__role">
                {ROLE_LABELS[msg.role] ?? msg.role}
                {msg.hidden ? (
                  <span className="chat-message__hidden-tag">已隐藏</span>
                ) : null}
                {onOpenMessageMenu ? (
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
                <ToolCallGroupCard
                  tools={item.tools}
                  dimmed={msg.hidden}
                  onOpenFile={onOpenToolFile}
                />
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
            {uiRunning ? (
              <p className="chat-message__stream-tail">生成中</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
