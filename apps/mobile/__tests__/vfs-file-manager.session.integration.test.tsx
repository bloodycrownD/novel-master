import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockGetOrRefresh = jest.fn();
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
  useToast: () => ({showToast: mockShowToast}),
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

jest.mock('../src/services/worktree-operations.service', () => ({
  batchSetDirRulesDisabled: jest.fn(),
  batchSetDirRulesEnabled: jest.fn(),
  cycleFileInclusion: jest.fn(),
  defaultDirRuleForm: jest.fn(),
  dirRuleToForm: jest.fn(),
  migrateWorktreeDirRename: jest.fn(),
  toggleDirRuleEnabled: jest.fn(),
  vfsScopeRootPath: () => '/',
}));

let capturedEntityMenuOnSelect: ((action: string) => void) | undefined;

jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: ({
    visible,
    onSelect,
    items,
  }: {
    visible: boolean;
    onSelect: (action: string) => void;
    items: {action: string}[];
  }) => {
    if (visible && items?.some(item => item.action === 'toggle-include')) {
      capturedEntityMenuOnSelect = onSelect;
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

jest.mock('../src/services/worktree-block.service', () => {
  const actual = jest.requireActual(
    '../src/services/worktree-block.service',
  ) as typeof import('../src/services/worktree-block.service');
  return {
    ...actual,
    captureSessionWorktreeBlockForMobile: jest.fn(),
  };
});

import {cycleFileInclusion} from '../src/services/worktree-operations.service';
import {captureSessionWorktreeBlockForMobile} from '../src/services/worktree-block.service';

const {VfsFileManager} = require('../src/components/vfs/VfsFileManager') as typeof import('../src/components/vfs/VfsFileManager');

const fixedListRows = [
  {
    kind: 'dir' as const,
    path: '/',
    ruleState: '',
    inclusionMode: '',
    displayState: '',
  },
  {
    kind: 'file' as const,
    path: '/note.md',
    ruleState: '',
    inclusionMode: '',
    displayState: '',
  },
];

const buildListRows = jest.fn(async () => fixedListRows);
const list = jest.fn(async () => []);
const getDirRule = jest.fn(async () => null);
const mockCapture = captureSessionWorktreeBlockForMobile as jest.Mock;

const mockRuntime = {
  worktreeBlockStore: {
    capture: jest.fn(),
    getCapturedBlock: jest.fn(),
  },
  worktree: jest.fn(),
};

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function renderSessionVfm(rootPath = '/') {
  return (
    <VfsFileManager
      scope={{
        kind: 'session',
        projectId: 'p1',
        sessionId: 's1',
      }}
      vfs={{list} as any}
      worktree={{buildListRows, getDirRule} as any}
      onOpenFile={jest.fn()}
      rootPath={rootPath}
    />
  );
}

describe('VfsFileManager session worktree snapshot', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    buildListRows.mockClear();
    list.mockClear();
    getDirRule.mockClear();
    mockCapture.mockClear();
    mockShowToast.mockClear();
    mockGetOrRefresh.mockReset();
    capturedEntityMenuOnSelect = undefined;
    (cycleFileInclusion as jest.Mock).mockReset();
    (cycleFileInclusion as jest.Mock).mockResolvedValue('show');
    buildListRows.mockResolvedValue(fixedListRows);
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('session reload uses buildListRows and never snapshot for list', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });

    expect(buildListRows).toHaveBeenCalled();
    expect(mockGetOrRefresh).not.toHaveBeenCalled();
  });

  it('path change triggers buildListRows reload without snapshot', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });
    buildListRows.mockClear();
    mockGetOrRefresh.mockClear();

    await act(async () => {
      tree!.update(renderSessionVfm('/subdir'));
      await flushPromises();
    });
    expect(buildListRows).toHaveBeenCalled();
    expect(mockGetOrRefresh).not.toHaveBeenCalled();
  });

  it('T-WEC6: capture 写入 block store，列表不经 snapshot', async () => {
    mockCapture.mockResolvedValue({
      worktreeDisplay: 'wt',
      capturedAtMs: 1,
    });
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });
    mockGetOrRefresh.mockClear();
    mockCapture.mockClear();

    await act(async () => {
      await mockCapture(mockRuntime, {
        projectId: 'p1',
        sessionId: 's1',
      });
    });
    expect(mockCapture).toHaveBeenCalledWith(mockRuntime, {
      projectId: 'p1',
      sessionId: 's1',
    });
    expect(mockGetOrRefresh).not.toHaveBeenCalled();
  });

  it('file toggle-include 调用 captureSessionWorktreeBlockForMobile', async () => {
    mockCapture.mockResolvedValue({
      worktreeDisplay: 'wt',
      capturedAtMs: 1,
    });
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });
    mockCapture.mockClear();
    mockGetOrRefresh.mockClear();

    const menuBtn = tree!.root.findByProps({testID: 'vfs-row-menu-note.md'});
    await act(async () => {
      menuBtn.props.onPress();
      await flushPromises();
    });
    expect(capturedEntityMenuOnSelect).toBeDefined();

    await act(async () => {
      await capturedEntityMenuOnSelect!('toggle-include');
      await flushPromises();
    });

    expect(cycleFileInclusion).toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(mockRuntime, {
      projectId: 'p1',
      sessionId: 's1',
    });
    expect(mockGetOrRefresh).not.toHaveBeenCalled();
  });
});
