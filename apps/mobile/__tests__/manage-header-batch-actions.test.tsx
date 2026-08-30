/**
 * ManageHeader（mobile）批量 actions 数组测试（原 VfsBatchHeader 迁移）。
 *
 * - selectedCount 为 0 时主操作（删除）与次操作（移动）统一禁用
 * - selectedCount > 0 时启用，点击次操作触发回调
 * - 次操作可传 disabled 覆盖统一禁用规则
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {ManageHeader} from '@/components/batch/ManageHeader';

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

jest.mock('@/components/ui/PrototypeButtons', () => ({
  SecondaryButton: () => null,
  PrimaryButton: () => null,
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

function renderBatchHeader(
  selectedCount: number,
  handlers: {onDelete: () => void; onMove: () => void},
) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ManageHeader
        batchMode
        selectedCount={selectedCount}
        onCancelBatch={jest.fn()}
        onDelete={handlers.onDelete}
        actions={[{label: '移动', onPress: handlers.onMove}]}
      />,
    );
  });
  return tree;
}

describe('ManageHeader 批量 actions（VFS 迁移）', () => {
  const handlers = {
    onDelete: jest.fn(),
    onMove: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selectedCount 为 0 时禁用删除/移动', () => {
    const tree = renderBatchHeader(0, handlers);
    const pressables = findAllPressables(tree.root);
    // 取消 + 删除 + 移动
    expect(pressables).toHaveLength(3);
    for (const button of pressables.slice(1)) {
      expect(button.props.disabled).toBe(true);
    }
  });

  it('selectedCount > 0 时启用删除/移动并可触发 onMove', () => {
    const tree = renderBatchHeader(2, handlers);
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
