/**
 * T-KB1：ScreenFormLayout 在 Android / iOS 两个分支下的渲染结构断言。
 *
 * Android 分支要走 Animated.View 裁切窗口（keyboardClip 带 overflow:hidden），
 * 并且 footer 必须排在 ScrollView 之后；iOS 分支则用 KeyboardAvoidingView。
 * mock 基建已经在 jest.config.js 里全局映射好了 reanimated / keyboard-controller。
 */
import React from 'react';
import {Platform, ScrollView, Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {afterEach, beforeEach, describe, expect, it} from '@jest/globals';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';

import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import type {ThemeTokens} from '@/theme/tokens';

const tokens: ThemeTokens = {
  background: '#fff',
} as unknown as ThemeTokens;

/** 覆盖 Platform.OS 为指定平台；用 getter 描述符以兼容 RN jest-preset 的 Platform 实现。 */
function setPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => os,
  });
}

/** 收集树里所有命中的节点（findAll 自动深度优先递归）。 */
function collectByPredicate(
  root: TestRenderer.ReactTestInstance,
  predicate: (node: TestRenderer.ReactTestInstance) => boolean,
): TestRenderer.ReactTestInstance[] {
  return root.findAll(node => predicate(node));
}

/** 在渲染树里按 predicate 深度优先查找第一个命中的实例。 */
function findByPredicate(
  root: TestRenderer.ReactTestInstance,
  predicate: (node: TestRenderer.ReactTestInstance) => boolean,
): TestRenderer.ReactTestInstance | undefined {
  return collectByPredicate(root, predicate)[0];
}

describe('ScreenFormLayout (T-KB1)', () => {
  afterEach(() => {
    // 还原为 jest-preset 默认平台（iOS），避免影响后续测试。
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'ios',
    });
  });

  it('Android 分支：渲染 overflow:hidden 的 Animated.View 裁切窗口，footer 排在 ScrollView 之后', () => {
    setPlatform('android');

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ScreenFormLayout tokens={tokens} footer={<Text>FOOTER</Text>}>
          <Text>BODY</Text>
        </ScreenFormLayout>,
      );
    });

    const root = tree.root;

    // 找到带 overflow:'hidden' 的 Animated.View（keyboardClip）。
    // reanimated mock 把 Animated.View 直接映射为 RN 的 View，所以按样式断言。
    const clipNode = findByPredicate(root, node => {
      const style = node.props?.style;
      if (style == null) {
        return false;
      }
      const styles = Array.isArray(style) ? style : [style];
      return styles.some(
        s =>
          s != null &&
          typeof s === 'object' &&
          (s as {overflow?: string}).overflow === 'hidden',
      );
    });
    expect(clipNode).toBeDefined();

    // 在 clipNode 子树里收集所有节点（文档序），定位 ScrollView 与 footer 文本的位置。
    const orderedNodes = clipNode!.findAll(() => true);
    const scrollViewIndex = orderedNodes.findIndex(n => n.type === ScrollView);
    expect(scrollViewIndex).toBeGreaterThanOrEqual(0);

    const footerIndex = orderedNodes.findIndex(
      n =>
        n.type === 'Text' &&
        n.props?.children === 'FOOTER' &&
        !Array.isArray(n.props?.children),
    );
    expect(footerIndex).toBeGreaterThan(scrollViewIndex);
  });

  it('iOS 分支：渲染 KeyboardAvoidingView 包裹内容', () => {
    setPlatform('ios');

    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ScreenFormLayout tokens={tokens} footer={<Text>FOOTER</Text>}>
          <Text>BODY</Text>
        </ScreenFormLayout>,
      );
    });

    // react-native-keyboard-controller 在 jest.config.js 里已映射为 test-utils mock，
    // 这里直接引用同一个 mock 的 KeyboardAvoidingView 函数做类型断言，确保 iOS 分支
    // 真正走了 KeyboardAvoidingView 包裹路径而不是 Android 的 Animated.View 裁切窗口。
    const kabv = tree.root.findAllByType(KeyboardAvoidingView as never);
    expect(kabv.length).toBeGreaterThanOrEqual(1);
  });
});
