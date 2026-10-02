import {describe, expect, it} from '@jest/globals';
/**
 * web/C-orch-4 布局口径的黄金值锁（Step 8 迁居）。
 *
 * 原本这里还断「RN 端口 `components/chat/anchored-menu-layout` 是 re-export，
 * 必须与真源同函数」——那是「双端口」纪律。Step 8 legacy 转录引擎退役后
 * RN 端口连同唯一消费者 `MessageActionMenu.tsx` 一起删了，消息菜单只剩 web
 * 文档内那一张，双端口不复存在，这条断言随之移除。
 *
 * 剩下的黄金值继续锁真源本身：WebView 端口 `runtime/menu/menu.ts` 只做 DOM
 * 取值后委托同一真源，下方黄金值来自重构前 WebView 内联公式（menu.ts L58-135）
 * 的手算结果，锁死共享后的输出不回归。
 */
import * as shared from '../src/webview-host/chat-transcript/anchored-menu-layout';

describe('anchored-menu-layout 黄金值（单端口：web 真源）', () => {
  const items = [
    {label: '编辑'},
    {label: '复制'},
    {label: '置位'},
    {label: '分叉'},
    {label: '回滚'},
  ];

  it('exports the layout math the web menu wrapper delegates to', () => {
    expect(typeof shared.layoutAnchoredMenu).toBe('function');
    expect(typeof shared.layoutAnchoredMenuForHeight).toBe('function');
    expect(typeof shared.computeAnchoredMenuWidth).toBe('function');
  });

  it('width matches the pre-refactor WebView formula (min width floor wins)', () => {
    // longest=2 → 2*14+32=60 < MIN_WIDTH 132；cap=360-24=336；min(336,200,132)=132
    expect(shared.computeAnchoredMenuWidth(items, 360)).toBe(132);
  });

  it('flips above with pre-refactor WebView golden layout', () => {
    const layout = shared.layoutAnchoredMenu(
      {x: 40, y: 520, width: 200, height: 48},
      items.length,
      132,
      360,
      640,
    );
    expect(layout).toEqual({
      left: 74,
      top: 272,
      width: 132,
      maxHeight: 240,
      scrollable: false,
    });
  });

  it('scrolls with height cap via layoutAnchoredMenuForHeight golden layout', () => {
    // WebView wrapper 走 layoutAnchoredMenuForHeight（measuredHeight 路径）
    const layout = shared.layoutAnchoredMenuForHeight(
      {x: 40, y: 200, width: 200, height: 48},
      480,
      132,
      360,
      640,
    );
    expect(layout).toEqual({
      left: 74,
      top: 256,
      width: 132,
      maxHeight: 288,
      scrollable: true,
    });
  });
});
