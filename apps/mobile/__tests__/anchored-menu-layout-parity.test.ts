import {describe, expect, it} from '@jest/globals';
/**
 * web/C-orch-4 双端口径一致性：
 * - RN 端口 `components/chat/anchored-menu-layout` 是 re-export，必须与真源同函数；
 * - WebView 端口 `runtime/menu/menu.ts` 只做 DOM 取值后委托同一真源，
 *   下方黄金值来自重构前 WebView 内联公式（menu.ts L58-135）的手算结果，
 *   锁死两端口共享后的输出不回归。
 */
import * as shared from '../src/webview-host/chat-transcript/anchored-menu-layout';
import * as rnReexport from '../src/components/chat/anchored-menu-layout';

describe('anchored-menu-layout dual-port parity', () => {
  const items = [
    {label: '编辑'},
    {label: '复制'},
    {label: '置位'},
    {label: '分叉'},
    {label: '回滚'},
  ];

  it('RN re-export resolves to the same shared functions', () => {
    expect(rnReexport.layoutAnchoredMenu).toBe(shared.layoutAnchoredMenu);
    expect(rnReexport.layoutAnchoredMenuForHeight).toBe(
      shared.layoutAnchoredMenuForHeight,
    );
    expect(rnReexport.computeAnchoredMenuWidth).toBe(
      shared.computeAnchoredMenuWidth,
    );
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
