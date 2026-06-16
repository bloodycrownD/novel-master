import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {MessageBatchHeader} from '../src/components/batch/MessageBatchHeader';
import {lightTheme} from '../src/theme/tokens';

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
    onConfirm: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('确认按钮在无选中时禁用', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageBatchHeader
          tokens={lightTheme}
          mode="hide"
          selectedCount={0}
          affectedCount={0}
          rangeLabel={null}
          {...handlers}
        />,
      );
    });
    const pressables = findAllPressables(tree.root);
    expect(pressables).toHaveLength(2);
    const confirm = pressables[1];
    expect(confirm.props.disabled).toBe(true);
  });

  it('有选中且存在范围预览时展示将影响条数', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageBatchHeader
          tokens={lightTheme}
          mode="hide"
          selectedCount={1}
          affectedCount={3}
          rangeLabel="seq 1–2"
          {...handlers}
        />,
      );
    });
    const texts = tree.root.findAll(node => node.type === 'Text');
    const summary = texts.find(
      node =>
        typeof node.props.children === 'string' &&
        node.props.children.includes('将影响 3 条'),
    );
    expect(summary).toBeDefined();
    const pressables = findAllPressables(tree.root);
    expect(pressables[1].props.disabled).toBe(false);
    act(() => {
      pressables[1].props.onPress?.();
    });
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });
});
