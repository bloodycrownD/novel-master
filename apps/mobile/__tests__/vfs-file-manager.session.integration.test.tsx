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

jest.mock('../src/services/worktree-operations.service', () => {
  const actual = jest.requireActual(
    '../src/services/worktree-operations.service',
  ) as typeof import('../src/services/worktree-operations.service');
  return {
    ...actual,
    batchSetDirRulesDisabled: jest.fn(),
    batchSetDirRulesEnabled: jest.fn(),
    cycleFileInclusion: jest.fn(),
    migrateWorktreeDirRename: jest.fn(),
    toggleDirRuleEnabled: jest.fn(),
  };
});

let capturedEntityMenuOnSelect: ((action: string) => void) | undefined;
let capturedMoreMenuOnSelect: ((action: string) => void) | undefined;
let capturedDirRuleOnSave: ((input: unknown) => Promise<void>) | undefined;

jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: ({
    visible,
    onSelect,
    items,
  }: {
    visible: boolean;
    onSelect: (action: string) => void;
    items: { action: string }[];
  }) => {
    if (visible && items?.some(item => item.action === 'toggle-include')) {
      capturedEntityMenuOnSelect = onSelect;
    }
    if (visible && items?.some(item => item.action === 'directory-rule')) {
      capturedMoreMenuOnSelect = onSelect;
    }
    return null;
  },
}));

jest.mock('../src/components/sheet/DirectoryRuleSheet', () => ({
  DirectoryRuleSheet: ({
    visible,
    onSave,
  }: {
    visible: boolean;
    onSave: (input: unknown) => Promise<void>;
  }) => {
    if (visible) {
      capturedDirRuleOnSave = onSave;
    }
    return null;
  },
}));

jest.mock('../src/components/template/TemplatePullButton', () => ({
  TemplatePullButton: () => null,
}));

jest.mock('../src/services/vfs-zip.service', () => ({
  exportVfsZip: jest.fn(),
  importVfsZip: jest.fn(),
}));

import { cycleFileInclusion } from '../src/services/worktree-operations.service';

const { VfsFileManager } =
  require('../src/components/vfs/VfsFileManager') as typeof import('../src/components/vfs/VfsFileManager');

const fixedListRows = [
  {
    kind: 'dir' as const,
    path: '/',
    ruleState: 'rule_on' as const,
  },
  {
    kind: 'file' as const,
    path: '/note.md',
    inclusionMode: 'auto' as const,
    displayState: 'full' as const,
  },
];

const buildListRows = jest.fn(async () => fixedListRows);
const list = jest.fn(async () => []);
const getDirRule = jest.fn(async () => null);
const setDirRule = jest.fn(async () => undefined);

const mockRuntime = {
  worktree: jest.fn(),
  sessionKkv: {
    clearSession: jest.fn(async () => undefined),
    listKeys: jest.fn(async () => []),
  },
};

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

async function waitFor(
  predicate: () => boolean,
  options?: { maxAttempts?: number },
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 50;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      await flushPromises();
    });
  }
  throw new Error('waitFor: condition not met');
}

function renderSessionVfm(rootPath = '/') {
  return (
    <VfsFileManager
      scope={{
        kind: 'session',
        projectId: 'p1',
        sessionId: 's1',
      }}
      vfs={{ list } as any}
      worktree={{ buildListRows, getDirRule, setDirRule } as any}
      onOpenFile={jest.fn()}
      rootPath={rootPath}
    />
  );
}

describe('VfsFileManager session list (no BlockStore capture)', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    buildListRows.mockClear();
    list.mockClear();
    getDirRule.mockClear();
    setDirRule.mockClear();
    mockShowToast.mockClear();
    capturedEntityMenuOnSelect = undefined;
    capturedMoreMenuOnSelect = undefined;
    capturedDirRuleOnSave = undefined;
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
  });

  it('path change triggers buildListRows reload without snapshot', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });
    buildListRows.mockClear();

    await act(async () => {
      tree!.update(renderSessionVfm('/subdir'));
      await flushPromises();
    });
    expect(buildListRows).toHaveBeenCalled();
  });

  it('T-WEC6: setDirRule 经 VfsFileManager 成功且不依赖 capture', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });
    buildListRows.mockClear();

    const moreBtn = tree!.root.findByProps({ testID: 'vfs-more-action' });
    await act(async () => {
      moreBtn.props.onPress();
      await flushPromises();
    });
    expect(capturedMoreMenuOnSelect).toBeDefined();

    await act(async () => {
      capturedMoreMenuOnSelect!('directory-rule');
      await flushPromises();
    });

    await waitFor(() => capturedDirRuleOnSave != null);
    expect(getDirRule).toHaveBeenCalled();

    await act(async () => {
      await capturedDirRuleOnSave!({
        logicalPath: '/',
        ruleEnabled: true,
        sortField: 'name',
        sortOrder: 'asc',
        fillPolicy: 'filename',
      });
      await flushPromises();
    });

    expect(setDirRule).toHaveBeenCalled();
    expect(buildListRows).toHaveBeenCalled();
  });

  it('file toggle-include 仅 cycle 规则，无 BlockStore', async () => {
    await act(async () => {
      tree = TestRenderer.create(renderSessionVfm());
      await flushPromises();
    });

    const menuBtn = tree!.root.findByProps({ testID: 'vfs-row-menu-note.md' });
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
  });
});
