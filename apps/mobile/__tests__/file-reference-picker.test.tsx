import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {WorkplaceListRow} from '@novel-master/core/workplace';
import {
  atPathTokensFromPickerSelection,
  FileReferencePicker,
  listPickerChildRows,
} from '@/components/chat/FileReferencePicker';

const mockBuildListRows = jest.fn(async (): Promise<WorkplaceListRow[]> => []);

jest.mock('@/errors/format-error', () => ({
  formatError: (err: unknown) => String(err),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      border: '#222',
      text: '#fff',
      textSecondary: '#ccc',
      primary: '#08f',
      danger: '#f00',
    },
  }),
}));

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
      visible ? mockReact.createElement('AppModal', null, children) : null,
  };
});

jest.mock('@/hooks/useRuntime', () => {
  const runtime = {
    workplace: () => ({
      buildListRows: (...args: unknown[]) => mockBuildListRows(...args),
    }),
  };
  return {
    useRuntime: () => runtime,
  };
});

const fixtureRows: WorkplaceListRow[] = [
  {kind: 'dir', path: '/', ruleState: 'rule_on'},
  {kind: 'dir', path: '/notes', ruleState: 'rule_on'},
  {
    kind: 'file',
    path: '/a.md',
    inclusionMode: 'show',
    displayState: 'full',
  },
  {
    kind: 'file',
    path: '/notes/b.md',
    inclusionMode: 'show',
    displayState: 'full',
  },
  {
    kind: 'file',
    path: '/notes/c.md',
    inclusionMode: 'show',
    displayState: 'full',
  },
  {
    kind: 'file',
    path: '/hidden.md',
    inclusionMode: 'hide',
    displayState: 'hidden',
  },
];

function findByTestId(root: TestRenderer.ReactTestInstance, testID: string) {
  return root.findByProps({testID});
}

describe('listPickerChildRows / atPathTokensFromPickerSelection', () => {
  it('只列出 cwd 直子（含隐藏文件，不含 cwd 自身）', () => {
    const atRoot = listPickerChildRows(fixtureRows, '/');
    expect(atRoot.map(r => r.path)).toEqual(['/notes', '/a.md', '/hidden.md']);

    const inNotes = listPickerChildRows(fixtureRows, '/notes');
    expect(inNotes.map(r => r.path)).toEqual(['/notes/b.md', '/notes/c.md']);
  });

  it('目录多选 + 文件多选同确认产出 @path token', () => {
    expect(
      atPathTokensFromPickerSelection(
        ['/notes', '/'],
        ['/a.md', '/notes/b.md'],
      ),
    ).toEqual(['@/notes/', '@/', '@/a.md', '@/notes/b.md']);
  });
});

describe('FileReferencePicker', () => {
  beforeEach(() => {
    mockBuildListRows.mockReset();
    mockBuildListRows.mockResolvedValue(fixtureRows);
  });

  it('点目录进入改 cwd；勾选目录确认产出 @path/ token', async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileReferencePicker
          visible
          projectId="p1"
          sessionId="s1"
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      );
    });

    expect(findByTestId(tree!.root, 'file-ref-cwd').props.children).toBe('/');

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-dir-enter-/notes').props.onPress();
    });
    expect(findByTestId(tree!.root, 'file-ref-cwd').props.children).toBe(
      '/notes',
    );

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-go-up').props.onPress();
    });
    expect(findByTestId(tree!.root, 'file-ref-cwd').props.children).toBe('/');

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-dir-check-/notes').props.onPress();
    });
    await act(async () => {
      findByTestId(tree!.root, 'file-ref-confirm').props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledWith(['@/notes/']);
    expect(onClose).toHaveBeenCalled();
  });

  it('文件多选确认产出多条 @path token', async () => {
    const onConfirm = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileReferencePicker
          visible
          projectId="p1"
          sessionId="s1"
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-dir-enter-/notes').props.onPress();
    });
    await act(async () => {
      findByTestId(tree!.root, 'file-ref-file-/notes/b.md').props.onPress();
      findByTestId(tree!.root, 'file-ref-file-/notes/c.md').props.onPress();
    });
    await act(async () => {
      findByTestId(tree!.root, 'file-ref-confirm').props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledWith(['@/notes/b.md', '@/notes/c.md']);
  });

  it('选择当前文件夹可选根目录 /', async () => {
    const onConfirm = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileReferencePicker
          visible
          projectId="p1"
          sessionId="s1"
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-select-cwd').props.onPress();
    });
    await act(async () => {
      findByTestId(tree!.root, 'file-ref-confirm').props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledWith(['@/']);
  });

  it('隐藏文件可见；勾选目录与文件不互斥', async () => {
    const onConfirm = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileReferencePicker
          visible
          projectId="p1"
          sessionId="s1"
          onClose={jest.fn()}
          onConfirm={onConfirm}
        />,
      );
    });

    // 根列表含隐藏文件
    expect(findByTestId(tree!.root, 'file-ref-file-/hidden.md')).toBeTruthy();

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-dir-check-/notes').props.onPress();
      findByTestId(tree!.root, 'file-ref-file-/a.md').props.onPress();
      findByTestId(tree!.root, 'file-ref-file-/hidden.md').props.onPress();
    });
    await act(async () => {
      findByTestId(tree!.root, 'file-ref-confirm').props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledWith([
      '@/notes/',
      '@/a.md',
      '@/hidden.md',
    ]);
  });

  it('pick-directory：确认当前 cwd；隐藏文件行；拦截源自身', async () => {
    const onConfirmDir = jest.fn();
    const onClose = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileReferencePicker
          visible
          mode="pick-directory"
          scope={{kind: 'session', projectId: 'p1', sessionId: 's1'}}
          blockedSourcePaths={['/notes']}
          onClose={onClose}
          onConfirmDir={onConfirmDir}
        />,
      );
    });

    // 不展示文件勾选
    expect(() => findByTestId(tree!.root, 'file-ref-file-/a.md')).toThrow();
    expect(findByTestId(tree!.root, 'file-ref-dir-/notes')).toBeTruthy();

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-confirm').props.onPress();
    });
    expect(onConfirmDir).toHaveBeenCalledWith('/');
    expect(onClose).toHaveBeenCalled();

    onConfirmDir.mockClear();
    onClose.mockClear();
    await act(async () => {
      findByTestId(tree!.root, 'file-ref-dir-enter-/notes').props.onPress();
    });
    expect(findByTestId(tree!.root, 'file-ref-cwd-blocked')).toBeTruthy();
    expect(findByTestId(tree!.root, 'file-ref-confirm').props.disabled).toBe(
      true,
    );
  });

  it('pick-directory：选择当前文件夹直接确认', async () => {
    const onConfirmDir = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FileReferencePicker
          visible
          mode="pick-directory"
          scope={{kind: 'project', projectId: 'p1'}}
          onClose={jest.fn()}
          onConfirmDir={onConfirmDir}
        />,
      );
    });

    await act(async () => {
      findByTestId(tree!.root, 'file-ref-select-cwd').props.onPress();
    });
    expect(onConfirmDir).toHaveBeenCalledWith('/');
  });
});
