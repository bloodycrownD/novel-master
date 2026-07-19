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
      danger: '#FF3B30',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
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
    ScrollView: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('ScrollView', props, children),
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

/** 检查 TextInput 祖先链中是否存在 ScrollView */
function hasScrollViewAncestor(
  node: TestRenderer.ReactTestInstance,
): boolean {
  let current: TestRenderer.ReactTestInstance | null = node.parent;
  while (current) {
    if (current.type === 'ScrollView') {
      return true;
    }
    current = current.parent;
  }
  return false;
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
  });

  it('T2: submitBehavior is newline; no onSubmitEditing or returnKeyType done', () => {
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
    expect(input.props.submitBehavior).toBe('newline');
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

  it('T6: backdrop uses symmetric spacers for vertical centering', () => {
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
    const topSpacer = tree.root.findByProps({testID: 'message-edit-top-spacer'});
    const bottomSpacer = tree.root.findByProps({
      testID: 'message-edit-bottom-spacer',
    });
    expect(topSpacer.props.style).toEqual(
      expect.objectContaining({
        flex: 1,
        flexShrink: 0,
        minHeight: 0,
      }),
    );
    expect(bottomSpacer.props.style).toEqual(
      expect.objectContaining({
        flex: 1,
        flexShrink: 1,
        minHeight: 0,
      }),
    );
    let backdrop: TestRenderer.ReactTestInstance | null = topSpacer.parent;
    while (backdrop && backdrop.type !== 'Pressable') {
      backdrop = backdrop.parent;
    }
    expect(backdrop?.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({flexDirection: 'column'}),
      ]),
    );
  });

  it('T5: no ScrollView wraps TextInput in the tree', () => {
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
    expect(hasScrollViewAncestor(input)).toBe(false);
  });

  it('readOnly: 输入禁用；同高度区间；删除/编辑可点', () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageEditModal
          visible
          title="批注"
          initialValue={'很长的批注\n'.repeat(20)}
          readOnly
          onClose={jest.fn()}
          onEdit={onEdit}
          onDelete={onDelete}
        />,
      );
    });
    const input = findTextInput(tree.root);
    expect(input.props.editable).toBe(false);
    expect(input.props.scrollEnabled).toBe(true);
    expect(input.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          minHeight: 120,
          maxHeight: Math.min(280, 800 * 0.32),
        }),
      ]),
    );
    const pressables = tree.root.findAllByType('Pressable' as never);
    const editBtn = pressables.find(p =>
      p.findAllByType('Text' as never).some(t => t.props.children === '编辑'),
    );
    const delBtn = pressables.find(p =>
      p.findAllByType('Text' as never).some(t => t.props.children === '删除'),
    );
    expect(editBtn).toBeTruthy();
    expect(delBtn).toBeTruthy();
    act(() => {
      editBtn!.props.onPress();
    });
    expect(onEdit).toHaveBeenCalled();
    act(() => {
      delBtn!.props.onPress();
    });
    expect(onDelete).toHaveBeenCalled();
  });
});
