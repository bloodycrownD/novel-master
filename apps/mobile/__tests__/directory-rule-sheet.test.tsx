/**
 * DirectoryRuleSheet（mobile）C-2：styles.form 键盘收缩契约（行为断言）。
 *
 * 面板 maxHeight 随键盘收缩时，超高内容要向内收缩（flexShrink: 1），
 * 否则底部按钮行（actions）会被裁出可视区——对齐 ToolPolicyPicker list 的写法。
 * tests/G-3：改 TestRenderer 渲染后断布局（渲染树里存在 flexShrink:1 的
 * 收缩容器），等价重构（挪样式、改写法）不再碎。mock 范式照
 * keyboard-avoid-android.test.tsx（AppModal 换透传 View）。
 *
 * 另一用例：排序方式改 PickerListModal 单选（UI 紧凑化）——值行点开弹层、
 * 选中回写、弹层关闭的交互闭环。
 */
import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {DirectoryRuleSheet} from '@/components/sheet/DirectoryRuleSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// DirectoryRuleSheet 与 ModalShell 都经 useTheme 取色板，给最小 tokens。
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      bgSecondary: '#eee',
      surface: '#f8f8f8',
      surfaceElevated: '#f0f0f0',
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

// AppModal 走 RN 原生 Modal，jest 环境渲染不出内容，换透传 View。
jest.mock('@/components/ui/AppModal', () => {
  const mockReact = require('react');
  return {
    AppModal: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
    }) =>
      visible
        ? mockReact.createElement('View', {testID: 'app-modal'}, children)
        : null,
  };
});

/** 把 RN style（对象/数组/嵌套数组）拍平成单层对象，忽略 StyleSheet id。 */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle));
  }
  if (style && typeof style === 'object') {
    return style as Record<string, unknown>;
  }
  return {};
}

describe('DirectoryRuleSheet (mobile) — C-2 flexShrink 契约', () => {
  it('渲染树存在 maxHeight + flexShrink:1 的收缩容器：键盘收缩时底部按钮行不被裁', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <DirectoryRuleSheet
          visible
          logicalPath="novel://project-x/"
          onClose={jest.fn()}
          onSave={jest.fn(async () => undefined)}
        />,
      );
    });
    const shrinkers = renderer.root.findAll(node => {
      const flat = flattenStyle(node.props?.style);
      return flat.flexShrink === 1 && typeof flat.maxHeight === 'number';
    });
    expect(shrinkers.length).toBeGreaterThan(0);
  });
});

describe('DirectoryRuleSheet (mobile) — 排序方式 PickerListModal 单选', () => {
  it('值行显示当前值，点开弹层选中「智能排序」后值行更新且弹层关闭', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <DirectoryRuleSheet
          visible
          logicalPath="novel://project-x/"
          initial={{sortField: 'name'}}
          onClose={jest.fn()}
          onSave={jest.fn(async () => undefined)}
        />,
      );
    });
    expect(
      renderer.root.findByProps({testID: 'sort-field-value'}).props.children,
    ).toBe('文件名称');

    await act(async () => {
      renderer.root
        .findByProps({testID: 'sort-field-value-row'})
        .props.onPress();
    });
    // PickerListModal 的 load 是异步，flush 后选项行才渲染。
    await act(async () => {});
    const optionSmart = renderer.root.findByProps({
      testID: 'sort-field-option-smart',
    });
    await act(async () => {
      optionSmart.props.onPress();
    });

    expect(
      renderer.root.findByProps({testID: 'sort-field-value'}).props.children,
    ).toBe('智能排序');
    // 选中即关：弹层卸载，选项行不再存在。
    expect(
      renderer.root.findAll(
        node => node.props?.testID === 'sort-field-option-smart',
      ).length,
    ).toBe(0);
  });
});
