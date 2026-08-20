import { useState } from 'react';
import { MermaidMarkdown } from '../../components/MermaidMarkdown';
import type { ChatMessageDto } from '@shared/ipc-types';
import { buildChatListItems } from './message-blocks';
import { ToolCallGroupCard } from './ToolCallGroupCard';
import { MessageAttachmentGroupCard } from './MessageAttachmentGroupCard';

const ROLE_LABELS: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
};

interface MessageListProps {
  messages: readonly ChatMessageDto[];
  /** 当前会话项目 id；skill 卡片跳设置详情需要。 */
  projectId?: string;
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
  /** 点击 task 工具卡片时跳转只读子会话面板。 */
  onOpenSubagentSession?: (sessionId: string) => void;
  /** 搜索结果等场景：长文本消息默认折叠（line-clamp 4 行），点击切换展开；默认关闭。 */
  collapsibleMessageBody?: boolean;
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
        <MermaidMarkdown content={text} />
      </div>
    );
  }
  return <p>{text}</p>;
}

/** 与 mobile MessageResultCard 一致的静态溢出规则：超 200 字符或含换行即可折叠。 */
function isCollapsibleText(text: string): boolean {
  return text.length > 200 || text.includes('\n');
}

/**
 * 长文本消息折叠 wrapper：默认 line-clamp 截 4 行，点击切换展开（无动画）。
 *
 * 实现注（spec 风险节回退条款）：富文本（richText || alwaysRichText）不进 clamp
 * wrapper、不折叠，直接渲染 MessageBody——markdown 富文本天然多行且含块级元素
 * （表格 / SVG / 嵌套块），line-clamp 按行数截断对块级元素的截断形态不可预期，
 * 且折叠容器的 onClick 会拦截富文本内链接的点击。纯文本消息维持
 * isCollapsibleText 静态溢出规则的折叠行为不变。
 */
function CollapsibleMessageBody({
  text,
  richText,
  alwaysRichText = false,
}: {
  text: string;
  richText: boolean;
  alwaysRichText?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (richText || alwaysRichText) {
    return (
      <MessageBody text={text} richText={richText} alwaysRichText={alwaysRichText} />
    );
  }
  if (!isCollapsibleText(text)) {
    return (
      <MessageBody text={text} richText={richText} alwaysRichText={alwaysRichText} />
    );
  }
  return (
    <div
      className={`chat-message__body-clamp${
        expanded ? ' chat-message__body-clamp--expanded' : ''
      }`}
      onClick={() => setExpanded(v => !v)}
    >
      <MessageBody text={text} richText={richText} alwaysRichText={alwaysRichText} />
    </div>
  );
}

export function MessageList({
  messages,
  projectId,
  uiRunning = false,
  streamingText,
  streamingThinking,
  streamTailGenerating: _streamTailGenerating = false,
  agentRunning = false,
  chatRichText = false,
  onOpenMessageMenu,
  onOpenToolFile,
  onOpenSubagentSession,
  collapsibleMessageBody = false,
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

  const listItems = buildChatListItems(messages, {
    agentRunning,
    runUiStopped: !uiRunning,
  });

  return (
    <>
      {listItems.map(item => {
        const msg = item.message;
        const text = item.textParts.join('\n');

        return (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}${
              msg.hidden ? ' chat-message--hidden' : ''
            }`}
            data-message-id={msg.id}
            onContextMenu={e => {
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
                    onClick={e => openMenu(msg, e)}
                  >
                    ⋯
                  </button>
                ) : null}
              </span>
              {item.thinkingParts.length > 0 ? (
                <details className="chat-message__thinking">
                  <summary>思考过程</summary>
                  <p>{item.thinkingParts.join('\n')}</p>
                </details>
              ) : null}
              {text ? (
                collapsibleMessageBody ? (
                  <CollapsibleMessageBody
                    text={text}
                    richText={chatRichText}
                    alwaysRichText={msg.role === 'assistant'}
                  />
                ) : (
                  <MessageBody
                    text={text}
                    richText={chatRichText}
                    alwaysRichText={msg.role === 'assistant'}
                  />
                )
              ) : null}
              {msg.role === "user" &&
              (msg.attachments?.length ?? 0) > 0 ? (
                <MessageAttachmentGroupCard
                  attachments={msg.attachments!}
                  dimmed={msg.hidden}
                />
              ) : null}
              {item.tools.length > 0 ? (
                <ToolCallGroupCard
                  tools={item.tools}
                  dimmed={msg.hidden}
                  projectId={projectId}
                  onOpenFile={onOpenToolFile}
                  onOpenSubagentSession={onOpenSubagentSession}
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
                <MermaidMarkdown content={streamingText} />
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
