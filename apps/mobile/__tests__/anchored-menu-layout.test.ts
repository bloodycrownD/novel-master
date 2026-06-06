import {describe, expect, it} from '@jest/globals';
import {
  anchoredMenuContentHeight,
  computeAnchoredMenuWidth,
  layoutAnchoredMenu,
} from '../src/components/chat/anchored-menu-layout';

describe('layoutAnchoredMenu', () => {
  const anchor = {x: 40, y: 520, width: 200, height: 48};
  const items = [
    {label: '编辑'},
    {label: '隐藏'},
    {label: '复制'},
    {label: 'Fork'},
    {label: '回滚'},
    {label: '删除'},
  ];

  it('flips above when the bubble is near the bottom edge', () => {
    const menuWidth = computeAnchoredMenuWidth(items, 360);
    const layout = layoutAnchoredMenu(anchor, items.length, menuWidth, 360, 640);
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

  it('does not scroll for six items when viewport has room', () => {
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
