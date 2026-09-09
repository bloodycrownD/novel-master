/**
 * workspace-push spec T-WP8（mobile）——VfsFileManager 工具栏并排：
 * 传 pullFromParent + pushToParent 时「从上级同步」与「推送到项目工作区」
 * 两个按钮并排渲染；readOnly 模式下两者都隐藏（覆盖类操作不外露）。
 * mock 清单裁剪自 vfs-file-manager.readonly.test.tsx。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

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

// showToast 引用必须固定（模块级）：VfsFileManager 的 reload useCallback
// 依赖 showToast，内联 jest.fn() 每次渲染换引用会触发 effect 死循环。
const mockShowToast = jest.fn();
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

// 轻量标记组件：testID 直接断言并排渲染与 readOnly 隐藏
jest.mock('@/components/prompt/TemplatePullButton', () => {
  const {createElement} = require('react') as typeof React;
  return {
    TemplatePullButton: () =>
      createElement('View', {testID: 'toolbar-pull'}),
  };
});

jest.mock('@/components/prompt/TemplatePushButton', () => {
  const {createElement} = require('react') as typeof React;
  return {
    TemplatePushButton: () =>
      createElement('View', {testID: 'toolbar-push'}),
  };
});

jest.mock('@/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
}));

jest.mock('@/components/sheet/DirectoryRuleSheet', () => ({
  DirectoryRuleSheet: () => null,
}));

jest.mock('@/services/vfs-zip.service', () => ({
  exportVfsZip: jest.fn(),
  importVfsZip: jest.fn(),
}));

jest.mock('@/services/vfs-character-card.service', () => ({
  importCharacterCard: jest.fn(),
}));

jest.mock('@/services/user-vfs-turn-execute.service', () => ({
  refreshComposerStatusAfterUserVfsOps: jest.fn(),
}));

jest.mock('@/services/workplace-rule-delta-draft.service', () => ({
  refreshRuleSnapshotAfterRuleChange: jest.fn(),
}));

jest.mock('@/hooks/useAndroidModalKeyboardAvoid', () => ({
  useAndroidModalKeyboardAvoid: () => ({}),
}));

const mockRuntime = {
  sessions: {pushTemplate: jest.fn(), pullTemplate: jest.fn()},
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

const {VfsFileManager} = require('../src/components/vfs/VfsFileManager') as {
  VfsFileManager: typeof import('../src/components/vfs/VfsFileManager').VfsFileManager;
};

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('VfsFileManager 工具栏 pull/push 并排（T-WP8）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('传 pullFromParent + pushToParent 时两按钮并排；readOnly 隐藏', async () => {
    const vfsStub = {
      list: jest.fn(async () => [] as Array<{path: string; kind: string}>),
      read: async () => ({content: '', version: 1}),
    };
    const mount = async (readOnly?: boolean) => {
      let tree: TestRenderer.ReactTestRenderer | undefined;
      await act(async () => {
        tree = TestRenderer.create(
          <VfsFileManager
            scope={{kind: 'session', projectId: 'p1', sessionId: 's1'}}
            vfs={vfsStub as never}
            onOpenFile={() => {}}
            pullFromParent={{
              scope: {kind: 'session', sessionId: 's1'},
              onPulled: () => {},
            }}
            pushToParent={{
              scope: {kind: 'session', sessionId: 's1'},
              onPushed: () => {},
            }}
            readOnly={readOnly}
          />,
        );
        await flushPromises();
      });
      if (tree == null) {
        throw new Error('渲染失败');
      }
      return tree;
    };

    const normal = await mount();
    expect(normal.root.findByProps({testID: 'toolbar-pull'})).toBeTruthy();
    expect(normal.root.findByProps({testID: 'toolbar-push'})).toBeTruthy();

    const readonly = await mount(true);
    expect(
      readonly.root.findAllByProps({testID: 'toolbar-pull'}).length,
    ).toBe(0);
    expect(
      readonly.root.findAllByProps({testID: 'toolbar-push'}).length,
    ).toBe(0);
  });
});