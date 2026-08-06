/**
 * html 壳级事件委托（#scroller / #rows）。
 * 监听挂在静态壳上，不随 RowList Preact 重绘；点击经冒泡委托处理。
 * 消息菜单由气泡右上角 ⋯ 触发（`openContextMenuFromAnchor`），不再绑定长按开菜单。
 */
import { onScroll, scheduleStickIfNearBottom } from '../scroll/scroll';
import { onRowsClick } from '../render/rows-click';

/** 绑定滚动与行区 click；可重复调用时依赖浏览器同函数引用去重行为，boot 只调一次。 */
export function bindShellEvents(): void {
  const scroller = document.getElementById('scroller');
  const rows = document.getElementById('rows');
  if (scroller) {
    scroller.addEventListener('scroll', onScroll, { passive: true });
    // 键盘弹起时 RN 侧用 marginBottom 动画收缩 viewport，webview 的 clientHeight
    // 会跟着变小。用 ResizeObserver 在 web 内部帧帧响应：如果当前贴底就自动
    // stickToBottom，不需要 RN → bridge → web 的 JS round-trip，比 nonce 方案平滑。
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        scheduleStickIfNearBottom();
      });
      ro.observe(scroller);
    }
  }
  if (!rows) return;
  rows.addEventListener('click', onRowsClick);
}
