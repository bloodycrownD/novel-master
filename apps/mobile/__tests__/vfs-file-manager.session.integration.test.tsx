import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';

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

let capturedDismissOverlays: (() => void) | undefined;

jest.mock('../src/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: (dismiss: () => void) => {
    capturedDismissOverlays = dismiss;
  },
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

type CapturedSheet = {
  onSelect: (action: string) => void;
  items: {action: string; label?: string}[];
};

/**
 * jest.mock 工厂里的 jest.fn() 没有签名，断言时按 any 收口
 * （直接 cast 成 jest.Mock 会把 mockResolvedValue 的入参推成 never）。
 */
function mockFn(fn: unknown) {
  return fn as jest.Mock<(...args: any[]) => any>;
}

let capturedEntityMenuOnSelect: ((action: string) => void) | undefined;
let capturedMoreMenuOnSelect: ((action: string) => void) | undefined;
let capturedDirRuleOnSave: ((input: unknown) => Promise<void>) | undefined;
/** 行菜单 / more 菜单 / 导入形式 sheet 的 items 与 onSelect（按 action 特征分流）。 */
let capturedEntityMenu: CapturedSheet | undefined;
let capturedMoreMenu: CapturedSheet | undefined;
let capturedImportSheet: CapturedSheet | undefined;

jest.mock('../src/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: ({
    visible,
    onSelect,
    items,
  }: {
    visible: boolean;
    onSelect: (action: string) => void;
    items: {action: string; label?: string}[];
  }) => {
    const actions = (items ?? []).map(item => item.action);
    // 三张 sheet 各自用互斥的 action 特征识别：行菜单含 rename/delete、
    // more 菜单含 create-file、导入形式 sheet 含 file/zip。
    if (visible && actions.some(a => a === 'rename' || a === 'delete')) {
      capturedEntityMenu = {onSelect, items};
      capturedEntityMenuOnSelect = onSelect;
    }
    if (visible && actions.some(a => a === 'create-file')) {
      capturedMoreMenu = {onSelect, items};
      capturedMoreMenuOnSelect = onSelect;
    }
    if (visible && actions.some(a => a === 'file' || a === 'zip')) {
      capturedImportSheet = {onSelect, items};
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

jest.mock('../src/components/prompt/TemplatePullButton', () => ({
  TemplatePullButton: () => null,
}));

jest.mock('../src/services/vfs-zip.service', () => ({
  exportVfsZip: jest.fn(),
  importVfsZip: jest.fn(),
}));

jest.mock('../src/services/vfs-character-card.service', () => ({
  importCharacterCard: jest.fn(),
}));

// Step 5 起组件直接 import 单文件服务（导入走 picker / 系统 UI，测试里一律 mock）。
jest.mock('../src/services/vfs-single-file.service', () => ({
  exportVfsSingleFile: jest.fn(),
  importVfsSingleFile: jest.fn(),
}));

import {cycleFileInclusion} from '../src/services/workplace-operations.service';
import {importCharacterCard} from '../src/services/vfs-character-card.service';
import {exportVfsZip, importVfsZip} from '../src/services/vfs-zip.service';
import {
  exportVfsSingleFile,
  importVfsSingleFile,
} from '../src/services/vfs-single-file.service';

const {VfsFileManager} =
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
// reload 现以 vfs.list() 为权威源（worktree 仅作元数据补丁）：
// 不在 vfs.list 结果里的路径会被当孤儿残留过滤掉，因此 list 需返回
// /note.md 的 VFS 条目，行才会渲染出行菜单按钮。
// 显式标注返回类型：菜单收敛用例需要 mock 出目录行。
type ListEntry = {path: string; kind: 'file' | 'directory'};
const list = jest.fn(
  async (): Promise<ListEntry[]> => [{path: '/note.md', kind: 'file'}],
);
const getDirRule = jest.fn(async () => null);
const setDirRule = jest.fn(async () => undefined);

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

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

async function waitFor(
  predicate: () => boolean,
  options?: {maxAttempts?: number},
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
      vfs={{list} as any}
      workplace={{buildListRows, getDirRule, setDirRule} as any}
      onOpenFile={jest.fn()}
      rootPath={rootPath}
    />
  );
}

/**
 * 无 workplace 的渲染（技能详情页形态）：行菜单不得出现导入/导出入口——
 * 防「导出」泄漏到技能域的回归断言面。
 */
function renderSessionVfmWithoutWorkplace() {
  return (
    <VfsFileManager
      scope={{
        kind: 'session',
        projectId: 'p1',
        sessionId: 's1',
      }}
      vfs={{list} as any}
      onOpenFile={jest.fn()}
      rootPath="/"
    />
  );
}

/** 复位被 mock 的服务：每次用例自己决定返回值。 */
function resetMenuServiceMocks() {
  mockFn(importVfsZip).mockReset();
  mockFn(exportVfsZip).mockReset();
  mockFn(exportVfsZip).mockResolvedValue('saved');
  mockFn(importCharacterCard).mockReset();
  mockFn(importCharacterCard).mockResolvedValue(undefined);
  mockFn(importVfsSingleFile).mockReset();
  mockFn(exportVfsSingleFile).mockReset();
  mockFn(exportVfsSingleFile).mockResolvedValue('saved');
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
    capturedEntityMenu = undefined;
    capturedMoreMenu = undefined;
    capturedImportSheet = undefined;
    capturedDismissOverlays = undefined;
    (cycleFileInclusion as jest.Mock).mockReset();
    (cycleFileInclusion as jest.Mock).mockResolvedValue('show');
    buildListRows.mockResolvedValue(fixedListRows);
    // 复位各用例可能改过的 list 返回值（默认只有 /note.md 文件行）。
    list.mockResolvedValue([{path: '/note.md', kind: 'file'}]);
    resetMenuServiceMocks();
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

    const moreBtn = tree!.root.findByProps({testID: 'vfs-more-action'});
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
  });
});

/**
 * vfs-import-export-menu Step 5（T-MM1 / T-MM2 / T-MM4 / T-MM5）：菜单收敛为
 * 「导入」「导出」+ 第三张导入形式 sheet + 导出按行类型分流。
 */
describe('VfsFileManager 导入导出菜单（Step 5）', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    buildListRows.mockClear();
    list.mockClear();
    mockShowToast.mockClear();
    capturedEntityMenu = undefined;
    capturedMoreMenu = undefined;
    capturedImportSheet = undefined;
    capturedDismissOverlays = undefined;
    list.mockResolvedValue([{path: '/note.md', kind: 'file'}]);
    buildListRows.mockResolvedValue(fixedListRows);
    resetMenuServiceMocks();
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
    jest.restoreAllMocks();
  });

  async function renderAndSettle(element: React.ReactElement) {
    await act(async () => {
      tree = TestRenderer.create(element);
      await flushPromises();
    });
  }

  async function openRowMenu(name: string) {
    const btn = tree!.root.findByProps({testID: `vfs-row-menu-${name}`});
    await act(async () => {
      btn.props.onPress();
      await flushPromises();
    });
  }

  async function openMoreMenu() {
    const btn = tree!.root.findByProps({testID: 'vfs-more-action'});
    await act(async () => {
      btn.props.onPress();
      await flushPromises();
    });
  }

  /** 取最近一次 Alert 的确认按钮并按下（标题/正文随用例断言）。 */
  function pressAlertConfirm(alertSpy: jest.SpiedFunction<typeof Alert.alert>) {
    const buttons = alertSpy.mock.calls.at(-1)![2] as {
      text: string;
      onPress?: () => void;
    }[];
    buttons.find(b => b.text === '导入')!.onPress!();
  }

  it('T-MM1：dir 行菜单与 more 菜单都是「导入」「导出」，旧三项已退役', async () => {
    list.mockResolvedValue([
      {path: '/sub', kind: 'directory'},
      {path: '/note.md', kind: 'file'},
    ]);
    await renderAndSettle(renderSessionVfm());

    await openRowMenu('sub');
    expect(capturedEntityMenu!.items.map(i => i.action)).toEqual([
      'export',
      'import',
      'toggle-include',
      'rename',
      'delete',
    ]);
    const dirLabels = capturedEntityMenu!.items.map(i => i.label);
    expect(dirLabels).toContain('导出');
    expect(dirLabels).toContain('导入');
    expect(dirLabels).not.toContain('导出 ZIP');
    expect(dirLabels).not.toContain('导入 ZIP');
    expect(dirLabels).not.toContain('导入角色卡');

    await openMoreMenu();
    expect(capturedMoreMenu!.items.map(i => i.action)).toEqual([
      'create-directory',
      'create-file',
      'import',
      'export',
      'directory-rule',
    ]);
    const moreLabels = capturedMoreMenu!.items.map(i => i.label);
    expect(moreLabels).toContain('导入');
    expect(moreLabels).toContain('导出');
  });

  it('T-MM2：file 行菜单含「导出」', async () => {
    await renderAndSettle(renderSessionVfm());
    await openRowMenu('note.md');
    expect(capturedEntityMenu!.items.map(i => i.action)).toEqual([
      'export',
      'toggle-include',
      'rename',
      'delete',
    ]);
  });

  it('T-MM2：无 workplace（技能详情页）时 file 行菜单不含「导出」', async () => {
    await renderAndSettle(renderSessionVfmWithoutWorkplace());
    await openRowMenu('note.md');
    expect(capturedEntityMenu!.items.map(i => i.action)).toEqual([
      'rename',
      'delete',
    ]);
    expect(capturedEntityMenu!.items.map(i => i.label)).not.toContain('导出');
  });

  it('T-MM5：file 行「导出」走单文件导出服务（logicalPath=行路径）', async () => {
    await renderAndSettle(renderSessionVfm());
    await openRowMenu('note.md');

    await act(async () => {
      capturedEntityMenu!.onSelect('export');
      await flushPromises();
    });

    expect(exportVfsSingleFile).toHaveBeenCalledWith(
      mockRuntime,
      expect.anything(),
      '/note.md',
    );
    expect(exportVfsZip).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('文件已保存到所选位置');
  });

  it('T-MM4：「导入」开第三张 sheet（单文件 / ZIP 包 / 角色卡）', async () => {
    await renderAndSettle(renderSessionVfm());
    await openMoreMenu();
    expect(capturedImportSheet).toBeUndefined();

    await act(async () => {
      capturedMoreMenu!.onSelect('import');
      await flushPromises();
    });

    expect(capturedImportSheet).toBeDefined();
    expect(capturedImportSheet!.items).toEqual([
      {label: '单文件', action: 'file'},
      {label: 'ZIP 包', action: 'zip'},
      {label: '角色卡', action: 'character-card'},
    ]);
  });

  it('T-MM4：sheet 选 zip / character-card 各走 runImport 对应链路与独立文案', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderAndSettle(renderSessionVfm());
    await openMoreMenu();
    await act(async () => {
      capturedMoreMenu!.onSelect('import');
      await flushPromises();
    });

    // ZIP：确认正文是「覆盖全部文件」语义。
    await act(async () => {
      capturedImportSheet!.onSelect('zip');
      await flushPromises();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [zipTitle, zipMessage] = alertSpy.mock.calls[0] as [string, string];
    expect(zipTitle).toBe('导入 ZIP');
    expect(zipMessage).toContain('全部文件');
    pressAlertConfirm(alertSpy);
    await act(async () => {
      await flushPromises();
    });
    expect(importVfsZip).toHaveBeenCalledWith(mockRuntime, expect.anything(), {
      confirmed: true,
      directoryPath: '/',
    });

    // 角色卡：标题与正文都与 ZIP 不同（独立文案）。
    await act(async () => {
      capturedImportSheet!.onSelect('character-card');
      await flushPromises();
    });
    const [cardTitle, cardMessage] = alertSpy.mock.calls.at(-1) as [
      string,
      string,
    ];
    expect(cardTitle).toBe('导入角色卡');
    expect(cardMessage).toContain('同名角色卡文件');
    expect(cardMessage).not.toBe(zipMessage);
    pressAlertConfirm(alertSpy);
    await act(async () => {
      await flushPromises();
    });
    expect(importCharacterCard).toHaveBeenCalledWith(
      mockRuntime,
      expect.anything(),
      {confirmed: true, directoryPath: '/'},
    );
  });

  it('T-MM4：sheet 选 file 走单文件导入；同名冲突先确认再落库', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const confirmMock = jest.fn(async () => ({
      status: 'applied' as const,
      report: {},
      skippedBinary: ['/blob.png'],
    }));
    mockFn(importVfsSingleFile).mockResolvedValue({
      status: 'needs-confirm',
      conflictCount: 2,
      fileName: 'note.md',
      confirm: confirmMock,
    });

    await renderAndSettle(renderSessionVfm());
    await openRowMenu('note.md');
    await act(async () => {
      capturedEntityMenu!.onSelect('import');
      await flushPromises();
    });

    await act(async () => {
      capturedImportSheet!.onSelect('file');
      await flushPromises();
    });

    expect(importVfsSingleFile).toHaveBeenCalledWith(
      mockRuntime,
      expect.anything(),
      {targetDir: '/note.md'},
    );
    // 冲突确认框：文案带同名文件数，且确认前不落库。
    const [confirmTitle, confirmMessage] = alertSpy.mock.calls.at(-1) as [
      string,
      string,
    ];
    expect(confirmTitle).toBe('导入单文件');
    expect(confirmMessage).toBe(
      '目标处已有 2 个同名文件，覆盖后不可撤销，是否继续？',
    );
    expect(confirmMock).not.toHaveBeenCalled();

    pressAlertConfirm(alertSpy);
    await act(async () => {
      await flushPromises();
    });
    expect(confirmMock).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      '已导入单文件，跳过 1 个非 UTF-8 文件',
    );
  });

  it('T-MM4：单文件导入 picker 取消静默（无 Alert 无 toast）', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockFn(importVfsSingleFile).mockResolvedValue({status: 'cancelled'});

    await renderAndSettle(renderSessionVfm());
    await openMoreMenu();
    await act(async () => {
      capturedMoreMenu!.onSelect('import');
      await flushPromises();
    });
    await act(async () => {
      capturedImportSheet!.onSelect('file');
      await flushPromises();
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('T-MM4：切走浮层（dismissAllOverlays）后导入 sheet 一并关闭', async () => {
    await renderAndSettle(renderSessionVfm());
    await openMoreMenu();
    await act(async () => {
      capturedMoreMenu!.onSelect('import');
      await flushPromises();
    });
    expect(capturedImportSheet).toBeDefined();

    capturedImportSheet = undefined;
    await act(async () => {
      capturedDismissOverlays!();
      await flushPromises();
    });
    expect(capturedImportSheet).toBeUndefined();
  });
});