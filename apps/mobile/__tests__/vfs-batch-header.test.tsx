import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {VfsBatchHeader} from '@/components/batch/VfsBatchHeader';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      primary: '#007aff',
      danger: '#ff3b30',
      border: '#ccc',
    },
  }),
}));

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Pressable: ({
      children,
      disabled,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      mockReact.createElement(
        'Pressable',
        {...props, disabled, onPress},
        children,
      ),
    StyleSheet: {
      hairlineWidth: 1,
      create: (s: object) => s,
    },
    Text: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', props, children),
    View: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', props, children),
  };
});

function findAllPressables(root: TestRenderer.ReactTestInstance) {
  return root.findAll(node => node.type === 'Pressable');
}

describe('VfsBatchHeader', () => {
  const handlers = {
    onCancel: jest.fn(),
    onDelete: jest.fn(),
    onMove: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selectedCount 为 0 时禁用删除/移动', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <VfsBatchHeader selectedCount={0} {...handlers} />,
      );
    });
    const pressables = findAllPressables(tree.root);
    // 取消 + 删除 + 移动
    expect(pressables).toHaveLength(3);
    for (const button of pressables.slice(1)) {
      expect(button.props.disabled).toBe(true);
    }
  });

  it('selectedCount > 0 时启用删除/移动并可触发 onMove', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <VfsBatchHeader selectedCount={2} {...handlers} />,
      );
    });
    const pressables = findAllPressables(tree.root);
    const [, deleteBtn, moveBtn] = pressables;
    for (const button of [deleteBtn, moveBtn]) {
      expect(button.props.disabled).toBe(false);
    }
    act(() => {
      moveBtn.props.onPress?.();
    });
    expect(handlers.onMove).toHaveBeenCalledTimes(1);
  });
});
