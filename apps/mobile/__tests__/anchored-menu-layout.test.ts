import {describe, expect, it} from '@jest/globals';
/**
 * Step 8：断言口径从 RN 端口 `components/chat/anchored-menu-layout`（re-export）
 * 改指真源 `webview-host/chat-transcript/anchored-menu-layout`。RN 端口与其唯一
 * 消费者 `MessageActionMenu.tsx` 一并退役（legacy 转录引擎删除后消息菜单只剩
 * web 文档内那一张），布局算法本身一字未动，只是没有第二个端口了。
 */
import {
  anchoredMenuContentHeight,
  computeAnchoredMenuWidth,
  layoutAnchoredMenu,
} from '@/webview-host/chat-transcript/anchored-menu-layout';

describe('layoutAnchoredMenu', () => {
  const anchor = {x: 40, y: 520, width: 200, height: 48};
  const items = [
    {label: '编辑'},
    {label: '复制'},
    {label: '置位'},
    {label: '分叉'},
    {label: '回滚'},
  ];

  it('flips above when the bubble is near the bottom edge', () => {
    const menuWidth = computeAnchoredMenuWidth(items, 360);
    const layout = layoutAnchoredMenu(
      anchor,
      items.length,
      menuWidth,
      360,
      640,
    );
    expect(layout.top).toBeLessThan(anchor.y);
  });

  it('opens below when there is room under the bubble', () => {
    const topAnchor = {x: 40, y: 80, width: 200, height: 48};
    const menuWidth = computeAnchoredMenuWidth(items, 360);
    const layout = layoutAnchoredMenu(
      topAnchor,
      items.length,
      menuWidth,
      360,
      640,
    );
    expect(layout.top).toBeGreaterThanOrEqual(
      topAnchor.y + topAnchor.height + 8,
    );
  });

  it('does not scroll for five items when viewport has room', () => {
    const menuWidth = computeAnchoredMenuWidth(items, 360);
    const layout = layoutAnchoredMenu(
      {x: 40, y: 200, width: 200, height: 48},
      items.length,
      menuWidth,
      360,
      640,
    );
    expect(layout.scrollable).toBe(false);
    expect(layout.maxHeight).toBe(anchoredMenuContentHeight(items.length));
  });

  it('does not scroll five items in a short WebView-sized viewport when wedge fits', () => {
    const menuWidth = computeAnchoredMenuWidth(items, 360);
    const layout = layoutAnchoredMenu(
      {x: 200, y: 316, width: 120, height: 40},
      items.length,
      menuWidth,
      360,
      469,
    );
    expect(layout.scrollable).toBe(false);
    expect(layout.maxHeight).toBe(anchoredMenuContentHeight(items.length));
  });

  it('scrolls when content exceeds the height cap', () => {
    const menuWidth = computeAnchoredMenuWidth(items, 360);
    const layout = layoutAnchoredMenu(
      {x: 40, y: 200, width: 200, height: 48},
      10,
      menuWidth,
      360,
      640,
    );
    expect(layout.scrollable).toBe(true);
    expect(layout.maxHeight).toBe(288);
  });
});
