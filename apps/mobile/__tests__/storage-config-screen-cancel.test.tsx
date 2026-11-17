/**
 * StorageConfigScreen 长任务取消入口（signal-abort-scope Step 14）。
 *
 * 断言：备份导出/导入在途出现「取消」入口、点击派发
 * `abortRegistry.abort(ABORT_KEY.backup('local'))`、取消终态静默复位且不弹
 * 错误 toast；数据清理（VACUUM 不可中断）全程不提供取消入口。
 *
 * 照 chat-config-screen-switch.test.tsx 的 TestRenderer 直测风格：ProfileMenuItem
 * mock 成带 testID 的可点击节点，备份 service 换可控 promise 模拟 AbortError。
 */
import React from 'react';
import {Alert} from 'react-native';
import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {ABORT_KEY, createAbortError} from '@novel-master/core/abort';
import {StorageConfigScreen} from '@/screens/stack/StorageConfigScreen';

const mockShowToast = jest.fn();
const mockAbort = jest.fn();
const mockNavigate = jest.fn();
const mockRetry = jest.fn();
const mockExportDatabaseBackup = jest.fn();
const mockImportDatabaseBackup = jest.fn();
const mockRunDatabaseMaintenance = jest.fn();
const mockGetDatabaseMaintenanceStats = jest.fn<() => Promise<unknown>>();
const mockGetCloudSyncLocalStatus = jest.fn<() => Promise<unknown>>();
const mockExportMobileLogs = jest.fn();

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f5f5f5',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ddd',
      bgSecondary: '#eee',
      primary: '#007aff',
      danger: '#f00',
      warning: '#a60',
      warningMuted: '#fee',
      success: '#0a0',
    },
  }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => ({abortRegistry: {abort: mockAbort}}),
}));

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({retry: mockRetry}),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
  useNavigation: () => ({navigate: mockNavigate}),
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => false,
  subscribeMobileAgentActivity: () => () => undefined,
}));

jest.mock('@/services/db-backup.service', () => ({
  exportDatabaseBackup: (..._args: unknown[]) => mockExportDatabaseBackup(),
  importDatabaseBackup: (..._args: unknown[]) => mockImportDatabaseBackup(),
}));

jest.mock('@/services/db-maintenance.service', () => ({
  getDbMaintenanceStats: (..._args: unknown[]) => mockGetDatabaseMaintenanceStats(),
  runDbMaintenance: (..._args: unknown[]) => mockRunDatabaseMaintenance(),
}));

jest.mock('@/services/log-export', () => ({
  exportMobileLogs: (..._args: unknown[]) => mockExportMobileLogs(),
}));

jest.mock('@/services/cloud-sync-config.store', () => ({
  getCloudSyncLocalStatus: (..._args: unknown[]) => mockGetCloudSyncLocalStatus(),
}));

jest.mock('@/components/profile/ProfileStatusCard', () => ({
  ProfileStatusCard: () => null,
}));

jest.mock('@/components/profile/ProfileMenuItem', () => {
  const mockReact = require('react');
  const {Pressable} = require('react-native');
  return {
    ProfileMenuItem: (props: {label: string; value?: string; onPress: () => void}) =>
      mockReact.createElement(Pressable, {
        testID: `menu-${props.label}`,
        value: props.value,
        onPress: props.onPress,
      }),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDatabaseMaintenanceStats.mockResolvedValue({
    ok: true,
    value: {fileBytes: 2048, reclaimableBytes: 1024},
  });
  mockGetCloudSyncLocalStatus.mockResolvedValue({
    ok: true,
    value: {configured: false},
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderScreen(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<StorageConfigScreen />);
  });
  return renderer;
}

function pressMenuItem(renderer: TestRenderer.ReactTestRenderer, label: string): void {
  act(() => {
    renderer.root.findByProps({testID: `menu-${label}`}).props.onPress();
  });
}

/** 触发 Alert 二次确认里的指定按钮（导出无 Alert，导入/清理有）。 */
function confirmAlert(buttonText: string): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find(button => button.text === buttonText)?.onPress?.();
  });
}

describe('StorageConfigScreen 长任务取消入口 — Step 14', () => {
  it('导出数据库在途显示取消入口，点击调 backup("local") abort，取消后静默复位', async () => {
    let rejectExport!: (error: unknown) => void;
    mockExportDatabaseBackup.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectExport = reject;
        }),
    );

    const renderer = renderScreen();
    pressMenuItem(renderer, '导出数据库');
    expect(mockExportDatabaseBackup).toHaveBeenCalledTimes(1);

    const cancel = renderer.root.findByProps({testID: 'menu-取消'});
    expect(cancel.props.value).toBe('导出数据库');
    act(() => {
      cancel.props.onPress();
    });
    expect(mockAbort).toHaveBeenCalledTimes(1);
    expect(mockAbort).toHaveBeenCalledWith(ABORT_KEY.backup('local'));

    await act(async () => {
      rejectExport(createAbortError());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByProps({testID: 'menu-取消'})).toHaveLength(0);
    expect(renderer.root.findByProps({testID: 'menu-导出数据库'}).props.value).toBe('分享备份文件');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('导入数据库在途同样可取消，取消不弹错误提示', async () => {
    let rejectImport!: (error: unknown) => void;
    mockImportDatabaseBackup.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectImport = reject;
        }),
    );
    confirmAlert('继续选择文件');

    const renderer = renderScreen();
    pressMenuItem(renderer, '导入数据库');
    expect(mockImportDatabaseBackup).toHaveBeenCalledTimes(1);

    const cancel = renderer.root.findByProps({testID: 'menu-取消'});
    expect(cancel.props.value).toBe('导入数据库');
    act(() => {
      cancel.props.onPress();
    });
    expect(mockAbort).toHaveBeenCalledWith(ABORT_KEY.backup('local'));

    await act(async () => {
      rejectImport(createAbortError());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByProps({testID: 'menu-取消'})).toHaveLength(0);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('数据清理在途不提供取消入口（VACUUM 不可中断）', async () => {
    let resolveCleanup!: (value: unknown) => void;
    mockRunDatabaseMaintenance.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveCleanup = resolve;
        }),
    );
    confirmAlert('开始清理');

    const renderer = renderScreen();
    pressMenuItem(renderer, '数据清理');
    expect(mockRunDatabaseMaintenance).toHaveBeenCalledTimes(1);
    // backupBusy 为空：清理在途不出现任何取消入口。
    expect(renderer.root.findAllByProps({testID: 'menu-取消'})).toHaveLength(0);

    await act(async () => {
      resolveCleanup({ok: true, value: {beforeBytes: 2048, afterBytes: 1024}});
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockAbort).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({testID: 'menu-取消'})).toHaveLength(0);
  });

  it('取消入口文案走 settings.long_task.cancel descriptor（双端共享同一 key）', () => {
    const source = readFileSync(join(__dirname, '../src/screens/stack/StorageConfigScreen.tsx'), 'utf8');
    expect(source).toMatch(/settingsTranslator\(\{key: 'settings\.long_task\.cancel'\}\)/);
  });
});
