/**
 * 普通消息行（user / assistant）。
 */
import type { MessageRow as MessageRowModel } from '../../runtime/state/state';
import { state } from '../../runtime/state/state';
import { assistantBubbleExtraClasses } from '../../runtime/stream/stream';
import { AttachGroup } from './AttachGroup';
import { AssistantBubbleInner } from './AssistantBubble';

export type MessageRowProps = {
  row: MessageRowModel;
};

export function MessageRow({ row }: MessageRowProps) {
  const role = row.role === 'user' ? 'user' : 'assistant';
  const hidden = row.hidden ? ' hidden' : '';
  const thinkingKey = 'msg:' + row.id;
  const thinkingExpanded = !!state.thinkingExpanded[thinkingKey];

  let bubble = null;
  if (role === 'user') {
    const attachments = row.attachments || [];
    const hasAttach = attachments.length > 0;
    const hasText = !!(row.text && String(row.text).length > 0);
    if (hasAttach || hasText) {
      if (hasAttach) {
        const attachKey = 'attach:' + row.id;
        const attachExpanded = !!state.attachGroupExpanded[attachKey];
        bubble = (
          <div className="bubble bubble--fill-width bubble--user-compose">
            {hasText ? (
              <div className="bubble-body">{String(row.text)}</div>
            ) : null}
            <AttachGroup
              attachments={attachments}
              groupKey={attachKey}
              expanded={attachExpanded}
              showDividerAbove={hasText}
            />
          </div>
        );
      } else {
        bubble = <div className="bubble">{String(row.text)}</div>;
      }
    }
  } else if (row.thinking || row.text || (row.tools && row.tools.length > 0)) {
    const toolGroupKey = 'msg:' + row.id;
    const toolGroupExpanded = !!state.toolGroupExpanded[toolGroupKey];
    bubble = (
      <div
        className={
          'bubble' +
          assistantBubbleExtraClasses(
            row.textHtml,
            row.tools,
            row.text,
            row.thinking,
          )
        }
      >
        <AssistantBubbleInner
          text={row.text}
          textHtml={row.textHtml}
          thinking={row.thinking}
          thinkingKey={thinkingKey}
          thinkingExpanded={thinkingExpanded}
          thinkingHtml={row.thinkingHtml}
          tools={row.tools}
          toolGroupKey={toolGroupKey}
          toolGroupExpanded={toolGroupExpanded}
          showToolInvoking={false}
          richText={state.flags.richText}
        />
      </div>
    );
  }

  return (
    <div
      className={'row message ' + role + hidden}
      data-id={row.id}
    >
      {bubble}
    </div>
  );
}
