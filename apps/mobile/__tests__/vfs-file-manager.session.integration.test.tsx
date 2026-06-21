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
  deleteVfsEntry: jest.fn(),
  remapPathUnderDir: jest.fn(),
  renameVfsDirectory: jest.fn(),
  renameVfsFile: jest.fn(),
  sessionCreateVfsDirectory: jest.fn(),
  sessionCreateVfsFile: jest.fn(),
  sessionDeleteVfsEntry: jest.fn(),
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

jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
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

jest.mock('../src/services/worktree-snapshot.service', () => {
  const actual = jest.requireActual(
    '../src/services/worktree-snapshot.service',
  ) as typeof import('../src/services/worktree-snapshot.service');
  return {
    ...actual,
    getOrRefreshSessionWorktreeSnapshot: (...args: unknown[]) =>
      mockGetOrRefresh(...args),
  };
});

import {invalidateSessionWorktreeSnapshot} from '../src/services/worktree-snapshot.service';

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
const markDirty = jest.fn();

const mockRuntime = {
  worktreeSnapshot: {
    markDirty,
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
    markDirty.mockClear();
    mockShowToast.mockClear();
    mockGetOrRefresh.mockReset();
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

  it('invalidate marks snapshot dirty without fetching list via snapshot', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });
    mockGetOrRefresh.mockClear();

    await act(async () => {
      invalidateSessionWorktreeSnapshot(mockRuntime as any, 'p1', 's1');
    });
    expect(markDirty).toHaveBeenCalledWith('p1', 's1');
    expect(mockGetOrRefresh).not.toHaveBeenCalled();
  });
});
