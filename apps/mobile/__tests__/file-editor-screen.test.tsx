import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {FileEditorScreen} from '../src/screens/stack/FileEditorScreen';

const mockDismiss = jest.fn();
const mockShowToast = jest.fn();

const mockRead = jest.fn(async () => ({
  content: '# Hello\n\nworld',
  version: 1,
  mtimeMs: 1_700_000_000_000,
}));

const mockWrite = jest.fn(async () => undefined);

const mockRuntime = {
  globalVfs: () => ({read: mockRead, write: mockWrite}),
  projectVfs: () => ({read: mockRead, write: mockWrite}),
  sessionVfs: () => ({read: mockRead, write: mockWrite}),
};

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({
    params: {
      path: '/notes/readme.md',
      scopeKind: 'global',
    },
  }),
  useNavigation: () => ({
    addListener: jest.fn(() => jest.fn()),
  }),
}));

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/hooks/useUnsavedGuard', () => ({
  useUnsavedGuard: jest.fn(),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f8f8f8',
      border: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#06c',
      danger: '#c00',
    },
  }),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

jest.mock('../src/services/vfs-operations.service', () => ({
  sessionSaveVfsFile: jest.fn(),
}));

jest.mock('../src/components/vfs/FileMarkdownPreview', () => {
  const mockReact = require('react');
  return {
    FileMarkdownPreview: (props: Record<string, unknown>) =>
      mockReact.createElement('View', {
        testID: 'file-markdown-preview',
        ...props,
      }),
    isMarkdownPreviewPath: () => true,
  };
});

jest.mock('../src/components/ui/SegmentedControl', () => {
  const mockReact = require('react');
  return {
    SegmentedControl: () =>
      mockReact.createElement('View', {testID: 'preview-segmented-control'}),
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    ActivityIndicator: () => mockReact.createElement('ActivityIndicator'),
    Keyboard: {dismiss: (...args: unknown[]) => mockDismiss(...args)},
    Pressable: ({
      children,
      onPress,
      disabled,
      testID,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      mockReact.createElement(
        'Pressable',
        {testID, onPress: disabled ? undefined : onPress, ...props},
        children,
      ),
    ScrollView: ({
      children,
      testID,
      ...props
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => mockReact.createElement('ScrollView', {testID, ...props}, children),
    StyleSheet: {
      hairlineWidth: 1,
      create: (s: object) => s,
    },
    Text: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => mockReact.createElement('Text', props, children),
    TextInput: (props: Record<string, unknown>) =>
      mockReact.createElement('TextInput', props),
    View: ({
      children,
      testID,
      ...props
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => mockReact.createElement('View', {testID, ...props}, children),
  };
});

function findToolbarPressableByLabel(
  root: TestRenderer.ReactTestInstance,
  label: string,
): TestRenderer.ReactTestInstance {
  const textNode = root.find(
    node => node.type === 'Text' && node.props.children === label,
  );
  let current: TestRenderer.ReactTestInstance | null = textNode;
  while (current && current.type !== 'Pressable') {
    current = current.parent;
  }
  if (!current) {
    throw new Error(`未找到标签为「${label}」的工具栏按钮`);
  }
  return current;
}

function findOptionalByTestId(
  root: TestRenderer.ReactTestInstance,
  testID: string,
): TestRenderer.ReactTestInstance | undefined {
  try {
    return root.findByProps({testID});
  } catch {
    return undefined;
  }
}

async function renderLoadedScreen(): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<FileEditorScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

async function switchToEditMode(
  tree: TestRenderer.ReactTestRenderer,
): Promise<void> {
  const editBtn = findToolbarPressableByLabel(tree.root, '编辑');
  await act(async () => {
    editBtn.props.onPress();
  });
}

describe('FileEditorScreen', () => {
  beforeEach(() => {
    mockDismiss.mockClear();
    mockShowToast.mockClear();
    mockRead.mockClear();
    mockWrite.mockClear();
    mockRead.mockResolvedValue({
      content: '# Hello\n\nworld',
      version: 1,
      mtimeMs: 1_700_000_000_000,
    });
  });

  it('T-F1: 进入编辑默认 browse，无可聚焦 input', async () => {
    const tree = await renderLoadedScreen();
    await switchToEditMode(tree);

    expect(findOptionalByTestId(tree.root, 'file-editor-browse-scroll')).toBeTruthy();
    expect(findOptionalByTestId(tree.root, 'file-editor-browse-press')).toBeTruthy();
    expect(findOptionalByTestId(tree.root, 'file-editor-input')).toBeUndefined();
  });

  it('T-F2: 点击 browse 区域后出现可编辑 input', async () => {
    const tree = await renderLoadedScreen();
    await switchToEditMode(tree);

    const browsePress = tree.root.findByProps({testID: 'file-editor-browse-press'});
    await act(async () => {
      browsePress.props.onPress();
    });

    const input = tree.root.findByProps({testID: 'file-editor-input'});
    expect(input.props.multiline).toBe(true);
    expect(input.props.value).toBe('# Hello\n\nworld');
  });

  it('T-F3: input blur 回 browse 并 dismiss 键盘', async () => {
    const tree = await renderLoadedScreen();
    await switchToEditMode(tree);

    const browsePress = tree.root.findByProps({testID: 'file-editor-browse-press'});
    await act(async () => {
      browsePress.props.onPress();
    });

    const input = tree.root.findByProps({testID: 'file-editor-input'});
    await act(async () => {
      input.props.onBlur?.();
    });

    expect(findOptionalByTestId(tree.root, 'file-editor-browse-scroll')).toBeTruthy();
    expect(findOptionalByTestId(tree.root, 'file-editor-input')).toBeUndefined();
    expect(mockDismiss).toHaveBeenCalled();
  });

  it('T-F3: 切预览回 browse 并 dismiss 键盘', async () => {
    const tree = await renderLoadedScreen();
    await switchToEditMode(tree);

    const browsePress = tree.root.findByProps({testID: 'file-editor-browse-press'});
    await act(async () => {
      browsePress.props.onPress();
    });
    mockDismiss.mockClear();

    const previewBtn = findToolbarPressableByLabel(tree.root, '预览');
    await act(async () => {
      previewBtn.props.onPress();
    });

    expect(findOptionalByTestId(tree.root, 'file-markdown-preview')).toBeTruthy();
    expect(findOptionalByTestId(tree.root, 'file-editor-input')).toBeUndefined();
    expect(mockDismiss).toHaveBeenCalled();
  });

  it('T-F4: 预览分支仍可渲染', async () => {
    const tree = await renderLoadedScreen();

    expect(findOptionalByTestId(tree.root, 'file-markdown-preview')).toBeTruthy();
    expect(findOptionalByTestId(tree.root, 'preview-segmented-control')).toBeTruthy();
    expect(findOptionalByTestId(tree.root, 'file-editor-browse-scroll')).toBeUndefined();
    expect(findOptionalByTestId(tree.root, 'file-editor-input')).toBeUndefined();
  });

  it('T-F6: browse 无 TextInput；聚焦 input scrollEnabled 为 true', async () => {
    const tree = await renderLoadedScreen();
    await switchToEditMode(tree);

    const textInputsInBrowse = tree.root.findAll(
      node => node.type === 'TextInput',
    );
    expect(textInputsInBrowse).toHaveLength(0);

    const browsePress = tree.root.findByProps({testID: 'file-editor-browse-press'});
    await act(async () => {
      browsePress.props.onPress();
    });

    const input = tree.root.findByProps({testID: 'file-editor-input'});
    expect(input.props.scrollEnabled).toBe(true);
    expect(input.props.showSoftInputOnFocus).toBe(true);
  });
});
