/**
 * 行列表根：加载更早 / 上占位 / 窗口行 / 下占位 / 流式尾 / 空态。
 *
 * init-busy-yield Step 7 窗口化：只渲染可见窗口内行（窗口与占位高度
 * 由 runtime/render/row-windowing 维护——ui 经 runtime 门面拿数据，不直读
 * 其内部状态）；窗口外用上下占位 div 按实测平均槽高估算撑高，滚动近界
 * 扩窗、远界收缩。
 *
 * E2 allowlist：可值导入 `state`；新 ui 组件禁直读——
 * 见 apps/mobile/README.md「E2：ui 禁值导入 state」；原门禁脚本已删，纪律见 README。）
 */
import type {ComponentChildren} from 'preact';
import {state} from '../../runtime/state/state';
import {
  getRowWindowRange,
  getRowWindowSpacerHeights,
  ROW_WINDOW_TOP_SPACER_ID,
  ROW_WINDOW_BOTTOM_SPACER_ID,
} from '../../runtime/render/row-windowing';
import {MessageRow} from './MessageRow';
import {StreamTail} from '../stream/StreamTail';

export function RowList() {
  const hasStream = !!(
    state.stream.text ||
    state.stream.thinking ||
    state.stream.toolInvoking
  );
  const total = state.rows.length;
  const showEmpty = total === 0 && !hasStream;
  const win = getRowWindowRange(total);
  const spacers = getRowWindowSpacerHeights(total);
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
  if (win.start > 0) {
    children.push(
      <div
        key="row-win-top"
        id={ROW_WINDOW_TOP_SPACER_ID}
        className="row-window-spacer"
        style={{height: `${spacers.top}px`}}
      />,
    );
  }
  for (let i = win.start; i < win.end; i++) {
    const row = state.rows[i];
    if (row.kind === 'message') {
      children.push(<MessageRow key={row.id} row={row} />);
    }
  }
  if (win.end < total) {
    children.push(
      <div
        key="row-win-bottom"
        id={ROW_WINDOW_BOTTOM_SPACER_ID}
        className="row-window-spacer"
        style={{height: `${spacers.bottom}px`}}
      />,
    );
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
