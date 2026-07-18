/**
 * html 壳级事件委托（#scroller / #rows）。
 * 监听挂在静态壳上，不随 RowList Preact 重绘；点击/长按经冒泡委托处理。
 */
import { onScroll } from '../scroll/scroll';
import { onRowsClick } from '../render/rows-click';
import {
  onMessagePointerDown,
  onMessagePointerMove,
  onMessagePointerUp,
} from '../menu/menu';

/** 绑定滚动与行区 click / 长按手势；可重复调用时依赖浏览器同函数引用去重行为，boot 只调一次。 */
export function bindShellEvents(): void {
  const scroller = document.getElementById('scroller');
  const rows = document.getElementById('rows');
  if (scroller) {
    scroller.addEventListener('scroll', onScroll, { passive: true });
  }
  if (!rows) return;
  rows.addEventListener('click', onRowsClick);
  rows.addEventListener('touchstart', onMessagePointerDown, { passive: true });
  rows.addEventListener('touchmove', onMessagePointerMove, { passive: true });
  rows.addEventListener('touchend', onMessagePointerUp, { passive: true });
  rows.addEventListener('touchcancel', onMessagePointerUp, { passive: true });
}
