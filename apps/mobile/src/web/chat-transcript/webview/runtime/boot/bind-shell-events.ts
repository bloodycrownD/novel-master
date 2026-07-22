/**
 * html 壳级事件委托（#scroller / #rows）。
 * 监听挂在静态壳上，不随 RowList Preact 重绘；点击经冒泡委托处理。
 * 消息菜单由气泡右上角 ⋯ 触发（`openContextMenuFromAnchor`），不再绑定长按开菜单。
 */
import { onScroll } from '../scroll/scroll';
import { onRowsClick } from '../render/rows-click';

/** 绑定滚动与行区 click；可重复调用时依赖浏览器同函数引用去重行为，boot 只调一次。 */
export function bindShellEvents(): void {
  const scroller = document.getElementById('scroller');
  const rows = document.getElementById('rows');
  if (scroller) {
    scroller.addEventListener('scroll', onScroll, { passive: true });
  }
  if (!rows) return;
  rows.addEventListener('click', onRowsClick);
}
