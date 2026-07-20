/**
 * 行列表根：加载更早 / 消息行 / 流式尾 / 空态。
 *
 * E2 allowlist：可值导入 `state`；新 ui 组件禁直读——
 * 见 apps/mobile/README.md「E2：ui 禁值导入 state」、scripts/check-ct-ui-no-state.mjs。
 */
import type { ComponentChildren } from 'preact';
import { state } from '../../runtime/state/state';
import { MessageRow } from './MessageRow';
import { StreamTail } from '../stream/StreamTail';

export function RowList() {
  const hasStream = !!(
    state.stream.text ||
    state.stream.thinking ||
    state.stream.toolInvoking
  );
  const showEmpty = state.rows.length === 0 && !hasStream;
  const children: ComponentChildren[] = [];

  if (state.hasMore) {
    children.push(
      <button
        type="button"
        key="load-older"
        className="load-older"
        data-action="load-older"
      >
        加载更早消息
      </button>,
    );
  }
  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i];
    if (row.kind === 'message') {
      children.push(<MessageRow key={row.id} row={row} />);
    }
  }
  children.push(<StreamTail key="stream-tail" />);
  if (showEmpty) {
    children.push(
      <div key="empty-state" className="empty-state">
        暂无消息
      </div>,
    );
  }
  return children;
}
