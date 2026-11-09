/**
 * 行列表根：加载更早 / 上占位 / 窗口行 / 下占位 / 流式行 / 空态。
 *
 * init-busy-yield Step 7 窗口化：只渲染可见窗口内行（窗口与占位高度
 * 由 runtime/render/row-windowing 维护——ui 经 runtime 门面拿数据，不直读
 * 其内部状态）；窗口外用上下占位 div 按实测平均槽高估算撑高，滚动近界
 * 扩窗、远界收缩。
 *
 * 流式行即最后一行（spec §3.2 / C24）：总行数天然计入 rows，空态只看 rows，
 * 不再有 StreamTail 兄弟节点。用户上滚把流式行移出窗口时，它钉在下占位之后
 * 单独渲染——**必须与窗口循环同一组件类型 `<MessageRow key={row.id}/>`**
 * （换成 StreamingMessageRow 会让 Preact 按 type 卸载重建、丢失 body 岛）。
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

export function RowList() {
  // 流式行是 rows 的最后一条（I1）：total 天然含它，空态只看 rows。
  const total = state.rows.length;
  const showEmpty = total === 0;
  const lastRow = total > 0 ? state.rows[total - 1] : null;
  // 只有当前 streaming 行需要钉住（finished 行内容静态，窗口外可卸载重挂）。
  const pinTail = lastRow != null && lastRow.status === 'streaming';
  const win = getRowWindowRange(total);
  const tailPinned = pinTail && win.end < total;
  const spacers = getRowWindowSpacerHeights(total, tailPinned);
  const children: ComponentChildren[] = [];

  if (state.hasMore) {
    children.push(
      <button
        type="button"
        key="load-older"
        className="load-older"
        data-action="load-older"
      >
        {state.labels.loadOlder}
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
  // 流式行被用户滚出窗口：钉在下占位之后（真实高度由 DOM 自己贡献，下占位
  // 已少算 1 行，估算不重复计入）。同一组件类型 → 窗口跨过它时不 remount。
  if (tailPinned && lastRow) {
    children.push(<MessageRow key={lastRow.id} row={lastRow} />);
  }
  if (showEmpty) {
    children.push(
      <div key="empty-state" className="empty-state">
        {state.labels.empty}
      </div>,
    );
  }
  return children;
}
