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
  const roleLabel = role === 'user' ? '用户' : '助手';

  /** ⋯ 菜单入口：与角色标签同一顶行（对齐 Desktop，不占右列）。 */
  const onMenuBtnClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const btn = event.currentTarget as HTMLButtonElement | null;
    if (!btn || typeof btn.getBoundingClientRect !== 'function') return;
    openContextMenuFromAnchor(row.id, btn.getBoundingClientRect(), btn);
  };

  const menuRow = (
    <div className="message-menu-row">
      <span className="message-role-label">{roleLabel}</span>
      <button
        type="button"
        className="message-menu-btn"
        aria-label="消息操作"
        onClick={onMenuBtnClick}
      >
        ⋯
      </button>
    </div>
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
            {menuRow}
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
        bubble = (
          <div className="bubble">
            {menuRow}
            <div className="bubble-body">{String(row.text)}</div>
          </div>
        );
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
        {menuRow}
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
