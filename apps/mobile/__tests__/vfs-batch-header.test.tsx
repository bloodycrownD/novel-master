import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {VfsBatchHeader} from '../src/components/batch/VfsBatchHeader';

jest.mock('../src/theme/ThemeProvider', () => ({
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
    onEnable: jest.fn(),
    onDisable: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables delete/enable/disable when selectedCount is 0', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <VfsBatchHeader selectedCount={0} {...handlers} />,
      );
    });
    const pressables = findAllPressables(tree.root);
    expect(pressables).toHaveLength(4);
    for (const button of pressables.slice(1)) {
      expect(button.props.disabled).toBe(true);
    }
  });

  it('enables actions when selectedCount is greater than 0', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <VfsBatchHeader selectedCount={2} {...handlers} />,
      );
    });
    const pressables = findAllPressables(tree.root);
    const [, deleteBtn, enableBtn, disableBtn] = pressables;
    for (const button of [deleteBtn, enableBtn, disableBtn]) {
      expect(button.props.disabled).toBe(false);
    }
    act(() => {
      enableBtn.props.onPress?.();
    });
    expect(handlers.onEnable).toHaveBeenCalledTimes(1);
  });
});
