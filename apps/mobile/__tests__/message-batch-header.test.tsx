import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {MessageBatchHeader} from '../src/components/batch/MessageBatchHeader';

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

describe('MessageBatchHeader', () => {
  const handlers = {
    onCancel: jest.fn(),
    onDelete: jest.fn(),
    onHide: jest.fn(),
    onRestore: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables delete/hide/restore when selectedCount is 0', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageBatchHeader selectedCount={0} {...handlers} />,
      );
    });
    const pressables = findAllPressables(tree.root);
    // cancel + three action buttons
    expect(pressables).toHaveLength(4);
    const actionButtons = pressables.slice(1);
    for (const button of actionButtons) {
      expect(button.props.disabled).toBe(true);
    }
  });

  it('enables delete/hide/restore when selectedCount is greater than 0', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageBatchHeader selectedCount={2} {...handlers} />,
      );
    });
    const pressables = findAllPressables(tree.root);
    expect(pressables).toHaveLength(4);
    const [cancel, deleteBtn, hideBtn, restoreBtn] = pressables;
    expect(cancel.props.disabled).toBeFalsy();
    for (const button of [deleteBtn, hideBtn, restoreBtn]) {
      expect(button.props.disabled).toBe(false);
      expect(typeof button.props.onPress).toBe('function');
    }
    act(() => {
      deleteBtn.props.onPress?.();
      hideBtn.props.onPress?.();
      restoreBtn.props.onPress?.();
    });
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onHide).toHaveBeenCalledTimes(1);
    expect(handlers.onRestore).toHaveBeenCalledTimes(1);
  });
});
