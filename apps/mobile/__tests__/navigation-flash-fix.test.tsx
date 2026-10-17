/**
 * 导航转场白闪 fix-E 防线回归（flash/G-1，cr-fix-spec round2）。
 *
 * 背景：fix-E（spec 补篇 3 / 变更点 #22-#24）三点防线全为纯 JS，全仓此前无
 * RootNavigator / StackScreenLayout 测试面（白闪族已四轮返工），删了不会红。
 * 本套件只锁防线形态、零实现改动：
 * - 渲染面：StackScreenLayout 屏根 View 实际带 tokens.background 底色（#24）；
 * - 源码契约面：RootNavigator 的 navHost 外衬（#22）与 navigationTheme 对齐
 *   （#23）——readFileSync 源码断言惯例先例见
 *   rich-document-webview-annotate-menu.test.tsx:97-105。
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: jest.fn()}),
  useRoute: () => ({key: 'test-route-key'}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {background: '#000'},
    mode: 'dark',
  }),
}));

// 真实 AppHeader 调 useHeaderContext，无 Provider 即 throw（先例：
// composer-fullscreen.test.tsx:254）。
jest.mock('@/components/chrome/AppHeader', () => ({AppHeader: () => null}));

import {StackScreenLayout} from '@/navigation/StackScreenLayout';

describe('导航转场白闪 fix-E 防线（flash/G-1）', () => {
  // T-PF9：屏根底色（#24）——转场 alpha 混合若剥到屏根，露的是主题色而非窗口浅色。
  it('T-PF9：StackScreenLayout 屏根 View 渲染 tokens.background 底色', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <StackScreenLayout pageKey="About">
          <View />
        </StackScreenLayout>,
      );
    });
    // 取屏根（树序第一个 View；子项是测试自挂的空 View）。
    const root = tree!.root.findAllByType(View)[0];
    const flat = StyleSheet.flatten(root?.props?.style as never) as Record<
      string,
      unknown
    >;
    expect(flat).toEqual(expect.objectContaining({backgroundColor: '#000'}));
  });

  // T-PF10：RootNavigator 源码契约（#22 navHost 外衬 + #23 nav 主题对齐）——
  // 两处均为 JS-only 改动，渲染面需要整棵导航树（本测试不搭），源码断言锁形态。
  it('T-PF10：RootNavigator 源码含 navHost 外衬与 navigationTheme 对齐', () => {
    const src = readFileSync(
      join(__dirname, '../src/navigation/RootNavigator.tsx'),
      'utf8',
    );
    // #22：NavigationContainer 外包 navHost View，底色走 tokens.background
    // （混合底=ScreenStack 容器透明时露的这层）。
    expect(src).toMatch(
      /styles\.navHost,\s*\{backgroundColor:\s*tokens\.background\}/,
    );
    expect(src).toMatch(/navHost:\s*\{\s*flex:\s*1\s*\}/);
    // #23：NavigationContainer 挂 theme={navigationTheme}；构造按 mode 取
    // Dark/Default 基础主题并覆写 colors.background。
    expect(src).toContain('theme={navigationTheme}');
    expect(src).toMatch(
      /mode\s*===\s*'dark'\s*\?\s*DarkTheme\s*:\s*DefaultTheme/,
    );
    expect(src).toMatch(
      /colors:\s*\{\.\.\.base\.colors,\s*background:\s*tokens\.background\}/,
    );
  });
});
