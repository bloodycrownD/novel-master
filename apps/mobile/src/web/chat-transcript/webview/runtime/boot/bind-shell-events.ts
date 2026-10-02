/**
 * html 壳级事件委托（#scroller / #rows）。
 * 监听挂在静态壳上，不随 RowList Preact 重绘；点击经冒泡委托处理。
 * 消息菜单由气泡右上角 ⋯ 触发（`openContextMenuFromAnchor`），不再绑定长按开菜单。
 */
import {onScroll, stickIfNearBottomNow} from '../scroll/scroll';
import {onRowsClick} from '../render/rows-click';
import {attachCodeCopyDelegation} from '@web/shared/code-copy';
import {post} from '../bridge';

/**
 * 模块级持有 #scroller 的 ResizeObserver（null = 还没建过 / 无 RO 环境）。
 *
 * 去重口径必须写死：`addEventListener` 靠「同一个函数引用」被浏览器自动去重，所以
 * bindShellEvents 重复调用时 scroll / click 监听**天然**只有一份；而 ResizeObserver
 * 是显式对象，不吃那套——每次 `new` 都是新实例，旧实例还活着 observe 着同一个
 * #scroller，于是尺寸变化每帧多触发一次 stickIfNearBottomNow（多写一次 scrollTop）。
 * 所以这里显式 disconnect 上一只再新建，把「可重复调用」真正做成幂等。
 */
let scrollerResizeObserver: ResizeObserver | null = null;

/** 绑定滚动与行区 click；可重复调用（listener 靠同引用去重，RO 走上面的 disconnect）。 */
export function bindShellEvents(): void {
  const scroller = document.getElementById('scroller');
  const rows = document.getElementById('rows');
  if (scroller) {
    scroller.addEventListener('scroll', onScroll, {passive: true});
    // 视口高度变化即时贴底（键盘顶起后消息「迟到上跳」修，语义见
    // stickIfNearBottomNow 注释）：键盘裁切逐帧、dock 留白过渡逐帧、
    // 输入框换行长高、chips 显隐——所有让 #scroller 高度变化的源都在这
    // 一处收口。typeof 守卫口径同 composer-input editor 的 visualViewport
    // 绑定；无 RO 的老 WebView 退化回旧行为（靠流式贴底事件兜），不更差。
    if (typeof ResizeObserver !== 'undefined') {
      scrollerResizeObserver?.disconnect();
      scrollerResizeObserver = new ResizeObserver(() =>
        stickIfNearBottomNow(),
      );
      scrollerResizeObserver.observe(scroller);
    }
  }
  if (!rows) return;
  rows.addEventListener('click', onRowsClick);
  // 代码块复制按钮：document 捕获委托，先于 rows 冒泡委托拦截
  attachCodeCopyDelegation(post);
}
