/**
 * ManageHeader（mobile）全选 props 测试：可选 onSelectAll / allSelected。
 *
 * - 不传 onSelectAll 时批量行不渲染「全选」按钮（其它调用方零影响）
 * - 传入后批量行显示「全选」；allSelected 为 true 时显示「全不选」
 * - 点击按钮触发 onSelectAll；非批量模式不渲染全选按钮
 */
import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      bgSecondary: '#eee',
      surface: '#f8f8f8',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#e0e0e0',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

import {ManageHeader} from '../src/components/batch/ManageHeader';

/** 递归收集渲染树里全部展示文本。 */
function treeText(
  node: TestRenderer.ReactTestInstance | string | number,
): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  let out = '';
  for (const child of node.children) {
    out += treeText(child);
  }
  return out;
}

function renderHeader(props: Partial<React.ComponentProps<typeof ManageHeader>>) {
  const onCancelBatch = jest.fn();
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ManageHeader
        title="已保存模型"
        batchMode
        selectedCount={0}
        onEnterBatch={jest.fn()}
        onCancelBatch={onCancelBatch}
        {...props}
      />,
    );
  });
  return {renderer: renderer!, text: () => treeText(renderer!.root)};
}

describe('ManageHeader 全选 props (mobile)', () => {
  it('不传 onSelectAll 时批量行不渲染全选按钮', () => {
    const {text} = renderHeader({});
    expect(text()).toContain('取消');
    expect(text()).toContain('已选 0 项');
    expect(text()).not.toContain('全选');
    expect(text()).not.toContain('全不选');
  });

  it('传 onSelectAll 后显示「全选」，点击触发回调', () => {
    const onSelectAll = jest.fn();
    const {renderer, text} = renderHeader({onSelectAll});
    expect(text()).toContain('全选');

    const btn = renderer.root
      .findAll(n => n.props && typeof n.props.onPress === 'function')
      .find(n => treeText(n).includes('全选'));
    expect(btn).toBeTruthy();
    act(() => {
      btn!.props.onPress();
    });
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('allSelected 为 true 时显示「全不选」', () => {
    const {text} = renderHeader({onSelectAll: jest.fn(), allSelected: true});
    expect(text()).toContain('全不选');
    expect(text()).not.toContain('全选');
  });

  it('非批量模式不渲染全选按钮', () => {
    const onSelectAll = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ManageHeader
          title="已保存模型"
          batchMode={false}
          selectedCount={0}
          onEnterBatch={jest.fn()}
          onCancelBatch={jest.fn()}
          onSelectAll={onSelectAll}
        />,
      );
    });
    const text = treeText(renderer.root);
    expect(text).toContain('已保存模型');
    expect(text).not.toContain('全选');
  });
});
