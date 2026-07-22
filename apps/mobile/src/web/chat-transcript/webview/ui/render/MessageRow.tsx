/**
 * 普通消息行（user / assistant）。
 *
 * E2 allowlist：可值导入 `state`；新 ui 组件禁直读——
 * 见 apps/mobile/README.md「E2：ui 禁值导入 state」、scripts/check-ct-ui-no-state.mjs。
 */
import type { MessageRow as MessageRowModel } from '../../runtime/state/state';
import { state } from '../../runtime/state/state';
import { openContextMenuFromAnchor } from '../../runtime/menu/menu';
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

  /** ⋯ 菜单入口：传按钮 rect 开菜单（user / assistant 均在气泡上方工具行）。 */
  const onMenuBtnClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.currentTarget as HTMLButtonElement | null;
    if (!btn || typeof btn.getBoundingClientRect !== 'function') return;
    openContextMenuFromAnchor(row.id, btn.getBoundingClientRect(), btn);
  };

  const menuBtn = (
    <button
      type="button"
      className="message-menu-btn"
      aria-label="消息操作"
      onClick={onMenuBtnClick}
    >
      ⋯
    </button>
  );

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
    // ⋯ 不进 .bubble，外置到行内气泡上方（见下方 return）
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
      {/* user / assistant ⋯ 均在 .row 内、.bubble 之前的工具行 */}
      {bubble ? <div className="message-menu-toolbar">{menuBtn}</div> : null}
      {bubble}
    </div>
  );
}
