import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockGetOrRefresh = jest.fn();

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
  useToast: () => ({showToast: jest.fn()}),
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

const buildListRows = jest.fn(async () => []);
const list = jest.fn(async () => []);
const getDirRule = jest.fn(async () => null);
const clear = jest.fn();

const mockRuntime = {
  macroCache: {
    get: jest.fn(),
    refresh: jest.fn(),
    clear,
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
  beforeEach(() => {
    buildListRows.mockClear();
    list.mockClear();
    getDirRule.mockClear();
    clear.mockClear();
    mockGetOrRefresh.mockReset();
    mockGetOrRefresh.mockImplementation(async (_runtime, _scope) => ({
      worktreeDisplay: 'wt',
      filetreeDisplay: 'ft',
      listRows: fixedListRows,
      refreshedAtMs: 1,
    }));
  });

  it('session reload uses snapshot listRows and never buildListRows', async () => {
    await act(async () => {
      TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });

    expect(mockGetOrRefresh).toHaveBeenCalledWith(
      mockRuntime,
      expect.objectContaining({projectId: 'p1', sessionId: 's1'}),
    );
    expect(buildListRows).not.toHaveBeenCalled();
  });

  it('invalidate clears macro cache and reload re-fetches snapshot', async () => {
    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });
    mockGetOrRefresh.mockClear();

    await act(async () => {
      invalidateSessionWorktreeSnapshot(mockRuntime as any, 'p1', 's1');
    });
    expect(clear).toHaveBeenCalledWith('p1', 's1');

    await act(async () => {
      tree!.update(renderSessionVfm('/subdir'));
      await flushPromises();
    });
    expect(mockGetOrRefresh).toHaveBeenCalled();
  });
});
