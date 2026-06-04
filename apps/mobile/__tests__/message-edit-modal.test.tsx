import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {MessageEditModal} from '../src/components/chat/MessageEditModal';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surface: '#fff',
      background: '#f5f5f5',
      border: '#ccc',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      primary: '#06c',
    },
  }),
}));

jest.mock('../src/components/ui/AppModal', () => {
  const mockReact = require('react');
  return {
    AppModal: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
    }) =>
      visible ? mockReact.createElement('Modal', null, children) : null,
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Dimensions: {
      get: () => ({width: 360, height: 800}),
    },
    KeyboardAvoidingView: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => mockReact.createElement('KeyboardAvoidingView', props, children),
    Platform: {OS: 'android'},
    Pressable: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      mockReact.createElement(
        'Pressable',
        {...props, onPress: disabled ? undefined : onPress},
        children,
      ),
    StyleSheet: {
      hairlineWidth: 1,
      create: (s: object) => s,
    },
    Text: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', props, children),
    TextInput: (props: Record<string, unknown>) =>
      mockReact.createElement('TextInput', props),
    View: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', props, children),
  };
});

function findTextInput(root: TestRenderer.ReactTestInstance) {
  return root.findByType('TextInput' as never);
}

function findSaveLabelText(root: TestRenderer.ReactTestInstance) {
  return root.find(
    node =>
      node.type === 'Text' &&
      (node.props.children === '保存' ||
        node.props.children === '保存中…'),
  );
}

function findSavePressable(root: TestRenderer.ReactTestInstance) {
  const label = findSaveLabelText(root);
  if (!label) {
    return undefined;
  }
  let node: TestRenderer.ReactTestInstance | null = label;
  while (node && node.type !== 'Pressable') {
    node = node.parent;
  }
  return node ?? undefined;
}

describe('MessageEditModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('T1: TextInput is multiline', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageEditModal
          visible
          title="编辑消息"
          confirmLabel="保存"
          initialValue="hello"
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    const input = findTextInput(tree.root);
    expect(input.props.multiline).toBe(true);
    expect(input.props.blurOnSubmit).toBe(false);
  });

  it('T2: no onSubmitEditing and no returnKeyType done', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageEditModal
          visible
          title="编辑消息"
          confirmLabel="保存"
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    const input = findTextInput(tree.root);
    expect(input.props.onSubmitEditing).toBeUndefined();
    expect(input.props.returnKeyType).toBeUndefined();
  });

  it('T3: save disabled for whitespace-only; enabled after trim-able text', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageEditModal
          visible
          title="编辑消息"
          confirmLabel="保存"
          initialValue="   "
          onClose={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
    });
    let saveText = findSaveLabelText(tree.root);
    expect(saveText.props.style.color).toBe('#999');

    const input = findTextInput(tree.root);
    act(() => {
      input.props.onChangeText('  hello  ');
    });
    saveText = findSaveLabelText(tree.root);
    expect(saveText.props.style.color).toBe('#06c');
  });

  it('T4: onConfirm receives trimmed value preserving internal newlines', async () => {
    const onConfirm = jest.fn(async () => undefined);
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageEditModal
          visible
          title="编辑消息"
          confirmLabel="保存"
          initialValue=""
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });
    const input = findTextInput(tree.root);
    act(() => {
      input.props.onChangeText('  line1\nline2\n  ');
    });
    const save = findSavePressable(tree.root);
    await act(async () => {
      save?.props.onPress?.();
    });
    expect(onConfirm).toHaveBeenCalledWith('line1\nline2');
  });
});
