/**
 * T-PB3：readOnly 模式下无新建/删除/更多菜单入口；点文件进只读预览。
 * 同时守住红线：默认（不传 readOnly）行为与现状完全一致。
 */
import React from 'react';
import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import TestRenderer, { act } from 'react-test-renderer';

const mockShowToast = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));

jest.mock('../src/theme/ThemeProvider', () => ({
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

jest.mock('../src/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: () => undefined,
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

jest.mock('../src/services/vfs-operations.service', () => ({
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

jest.mock('../src/services/workplace-operations.service', () => {
  const actual = jest.requireActual(
    '../src/services/workplace-operations.service',
  ) as typeof import('../src/services/workplace-operations.service');
  return {
    ...actual,
    batchSetDirRulesEnabled: jest.fn(),
    cycleFileInclusion: jest.fn(),
    migrateWorkplaceDirRename: jest.fn(),
    toggleDirRuleEnabled: jest.fn(),
  };
});

const mockMenuOpenCount = { opened: 0 };

jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: ({
    visible,
    items,
  }: {
    visible: boolean;
    onSelect: (action: string) => void;
    items: { action: string }[];
  }) => {
    if (visible && items.length > 0) {
      // 记录任何被打开的菜单（readOnly 断言应为零）。
      mockMenuOpenCount.opened += 1;
    }
    return null;
  },
}));

jest.mock('../src/components/sheet/DirectoryRuleSheet', () => ({
  DirectoryRuleSheet: () => null,
}));

jest.mock('../src/components/template/TemplatePullButton', () => ({
  TemplatePullButton: () => null,
}));

jest.mock('../src/services/vfs-zip.service', () => ({
  exportVfsZip: jest.fn(),
  importVfsZip: jest.fn(),
}));

jest.mock('../src/services/vfs-character-card.service', () => ({
  importCharacterCard: jest.fn(),
}));

jest.mock('../src/services/user-vfs-turn-execute.service', () => ({
  refreshComposerStatusAfterUserVfsOps: jest.fn(),
}));

jest.mock('../src/services/workplace-rule-delta-draft.service', () => ({
  refreshRuleSnapshotAfterRuleChange: jest.fn(),
}));

jest.mock('../src/hooks/useAndroidModalKeyboardAvoid', () => ({
  useAndroidModalKeyboardAvoid: () => ({}),
}));

const mockRuntime = {
  workplace: jest.fn(),
  sessionKkv: {
    clearSession: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  },
};

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

const { VfsFileManager } =
  require('../src/components/vfs/VfsFileManager') as typeof import('../src/components/vfs/VfsFileManager');

// 物理树根目录形态：虚拟目录 + 全局文件（list 为唯一数据源，workplace 不传）。
const list = jest.fn(async () => [
  { path: '/projects', kind: 'directory' as const },
  { path: '/template', kind: 'directory' as const },
  { path: '/meta', kind: 'directory' as const },
  { path: '/readme.md', kind: 'file' as const },
]);

const onOpenFile = jest.fn();

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function renderManager(readOnly: boolean) {
  return (
    <VfsFileManager
      scope={{ kind: 'global' }}
      vfs={{ list } as never}
      rootPath="/"
      readOnly={readOnly}
      onOpenFile={onOpenFile}
    />
  );
}

function findOptionalByTestId(
  root: TestRenderer.ReactTestInstance,
  testID: string,
): TestRenderer.ReactTestInstance | undefined {
  try {
    return root.findByProps({ testID });
  } catch {
    return undefined;
  }
}

describe('T-PB3: VfsFileManager readOnly 模式（全局文件浏览器）', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    list.mockClear();
    onOpenFile.mockClear();
    mockShowToast.mockClear();
    mockMenuOpenCount.opened = 0;
    list.mockResolvedValue([
      { path: '/projects', kind: 'directory' as const },
      { path: '/template', kind: 'directory' as const },
      { path: '/meta', kind: 'directory' as const },
      { path: '/readme.md', kind: 'file' as const },
    ]);
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('readOnly：无「更多」菜单与行菜单入口，长按不进批量', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderManager(true));
      await flushPromises();
    });

    expect(findOptionalByTestId(tree!.root, 'vfs-more-action')).toBeUndefined();
    expect(
      findOptionalByTestId(tree!.root, 'vfs-row-menu-readme.md'),
    ).toBeUndefined();
    expect(
      findOptionalByTestId(tree!.root, 'vfs-row-menu-template'),
    ).toBeUndefined();

    // 长按不挂监听（不进入批量多选）。
    const fileItem = tree!.root.findByProps({
      testID: 'vfs-row-item-readme.md',
    });
    expect(fileItem.props.onLongPress).toBeUndefined();
    // 无任何 BottomSheetMenu 被打开。
    expect(mockMenuOpenCount.opened).toBe(0);
  });

  it('readOnly：点文件走 onOpenFile（进只读预览），点目录可逐级导航', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderManager(true));
      await flushPromises();
    });

    await act(async () => {
      tree!.root
        .findByProps({ testID: 'vfs-row-item-readme.md' })
        .props.onPress();
      await flushPromises();
    });
    expect(onOpenFile).toHaveBeenCalledWith('/readme.md');

    await act(async () => {
      tree!.root
        .findByProps({ testID: 'vfs-row-item-template' })
        .props.onPress();
      await flushPromises();
    });
    expect(list).toHaveBeenCalledWith('/template');
  });

  it('红线：默认（不传 readOnly）「更多」与行菜单入口仍在', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderManager(false));
      await flushPromises();
    });

    expect(
      findOptionalByTestId(tree!.root, 'vfs-more-action'),
    ).toBeDefined();
    expect(
      findOptionalByTestId(tree!.root, 'vfs-row-menu-readme.md'),
    ).toBeDefined();
  });
});
