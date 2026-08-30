import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockShowToast = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      surfaceElevated: '#111',
      border: '#222',
      borderLight: '#222',
      text: '#fff',
      textSecondary: '#ccc',
      textTertiary: '#777',
      primary: '#08f',
      danger: '#f00',
    },
  }),
}));

jest.mock('@/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: () => undefined,
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

jest.mock('@/services/vfs-operations.service', () => ({
  createVfsDirectory: jest.fn(),
  createVfsFile: jest.fn(),
  deleteScopedVfsEntry: jest.fn(),
  remapPathUnderDir: jest.fn(),
  renameVfsDirectory: jest.fn(),
  renameVfsFile: jest.fn(),
  sessionCreateVfsDirectory: jest.fn(),
  sessionCreateVfsFile: jest.fn(),
  sessionRenameVfsDirectory: jest.fn(),
  sessionRenameVfsFile: jest.fn(),
}));

jest.mock('@/services/workplace-operations.service', () => ({
  cycleFileInclusion: jest.fn(),
  defaultDirRuleForm: jest.fn(() => ({})),
  dirRuleToForm: jest.fn(() => ({})),
  emptyDirRuleForm: jest.fn(() => ({})),
  migrateWorkplaceDirRename: jest.fn(),
  toggleDirRuleEnabled: jest.fn(),
  vfsScopeRootPath: jest.fn(() => '/'),
}));

jest.mock('@/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
}));

jest.mock('@/components/sheet/DirectoryRuleSheet', () => ({
  DirectoryRuleSheet: () => null,
}));

jest.mock('@/components/template/TemplatePullButton', () => ({
  TemplatePullButton: () => null,
}));

jest.mock('@/components/chat/FileReferencePicker', () => ({
  FileReferencePicker: () => null,
}));

jest.mock('@/services/vfs-zip.service', () => ({
  exportVfsZip: jest.fn(),
  importVfsZip: jest.fn(),
}));

const mockRuntime = {
  workplace: jest.fn(),
  sessionKkv: {
    clearSession: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  },
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

const {VfsFileManager} =
  require('@/components/vfs/VfsFileManager') as typeof import('@/components/vfs/VfsFileManager');

// 物理树 list 的 mock：每层目录返回一个子目录行，带 label 的行模拟
// 项目/会话名（物理树 list 对 /projects/{pid}、/projects/{pid}/sessions/{sid}
// 的合成行携带 label；/projects、sessions 等中间目录行不带 label）。
const listByPath: Record<
  string,
  {path: string; kind: 'directory'; label?: string}[]
> = {
  '/': [{path: '/projects', kind: 'directory'}],
  '/projects': [{path: '/projects/p1', kind: 'directory', label: '我的小说'}],
  '/projects/p1': [{path: '/projects/p1/sessions', kind: 'directory'}],
  '/projects/p1/sessions': [
    {path: '/projects/p1/sessions/s9', kind: 'directory', label: '第三章草稿'},
  ],
};
const list = jest.fn(async (path: string) => listByPath[path] ?? []);

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function currentPathText(tree: TestRenderer.ReactTestRenderer): string {
  const node = tree.root.findAllByProps({testID: 'vfs-current-path'})[0];
  expect(node).toBeDefined();
  return node.props.children as string;
}

function renderPhysicalVfm() {
  return (
    <VfsFileManager
      scope={{kind: 'global'}}
      vfs={{list} as any}
      onOpenFile={jest.fn()}
      rootPath="/"
      readOnly
    />
  );
}

/**
 * mobile/G-1 用例①：list 返回带 label 的合成目录行后，
 * labelByPathRef 逐层累积，顶栏路径逐段替换为展示名。
 * 顺带断言 mapVfsListEntry 的 label 回退分支（行名用 label 而非 basename）。
 */
describe('VfsFileManager 顶栏面包屑 label 替换（readOnly 物理树）', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    list.mockClear();
    mockShowToast.mockClear();
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('进入带 label 的目录后，顶栏路径逐段替换为展示名', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderPhysicalVfm());
      await flushPromises();
    });
    expect(currentPathText(tree!)).toBe('/');

    // 进入 /projects（无 label 的普通目录行）：顶栏保持原文。
    await act(async () => {
      tree!.root.findByProps({testID: 'vfs-row-item-projects'}).props.onPress();
      await flushPromises();
    });
    expect(currentPathText(tree!)).toBe('/projects');
    expect(list).toHaveBeenCalledWith('/projects');

    // /projects 的子行带 label「我的小说」：mapVfsListEntry 以 label
    // 作为行名（回退分支），点击进入该目录。
    const projectRow = tree!.root.findByProps({
      testID: 'vfs-row-item-我的小说',
    });
    await act(async () => {
      projectRow.props.onPress();
      await flushPromises();
    });
    // labelByPathRef 已累积 /projects/p1 → 我的小说，顶栏替换该段。
    expect(currentPathText(tree!)).toBe('/projects/我的小说');

    // sessions 是不带 label 的中间目录：顶栏该段保持原文。
    const sessionsRow = tree!.root.findByProps({
      testID: 'vfs-row-item-sessions',
    });
    await act(async () => {
      sessionsRow.props.onPress();
      await flushPromises();
    });
    expect(currentPathText(tree!)).toBe('/projects/我的小说/sessions');

    // 再进一层具体会话（label「第三章草稿」）：两段同时替换。
    const sessionRow = tree!.root.findByProps({
      testID: 'vfs-row-item-第三章草稿',
    });
    await act(async () => {
      sessionRow.props.onPress();
      await flushPromises();
    });
    expect(currentPathText(tree!)).toBe(
      '/projects/我的小说/sessions/第三章草稿',
    );
  });
});
