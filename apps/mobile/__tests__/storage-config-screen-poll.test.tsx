/**
 * StorageConfigScreen 维护指标轮询（ic-23 方案 A）行为测试。
 *
 * - 聚焦期间按 5s 间隔重采样：mock 两次采样返回不同剩余条数，advance
 *   timer 后 UI 值更新（进度不停在进页快照）；
 * - 失焦/卸载后 interval 被清：unmount（近似失焦——真实 useFocusEffect
 *   的 cleanup 同一函数同时覆盖失焦与卸载）后再 advance，采样不再发生。
 *
 * 照 token-usage-stats-screen.test.tsx 范式：useFocusEffect mock 成
 * useEffect（挂载即聚焦、卸载即失焦），runtime 固定引用防 effect 重跑。
 */
import React from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {StorageConfigScreen} from '@/screens/stack/StorageConfigScreen';

const mockGetStats = jest.fn();
const mockRunMaintenance = jest.fn();
const mockExportBackup = jest.fn();
const mockImportBackup = jest.fn();
const mockGetCloudLocalStatus = jest.fn();
const mockAgentActive = jest.fn();
const mockSubscribeAgent = jest.fn();
const mockRetry = jest.fn();
const mockShowToast = jest.fn();

const runtime = {conn: {tag: 'live'}} as never;

jest.mock('@/services/db-maintenance.service', () => ({
  getDatabaseMaintenanceStats: (...args: unknown[]) => mockGetStats(...args),
  runDatabaseMaintenance: (...args: unknown[]) => mockRunMaintenance(...args),
}));

jest.mock('@/services/db-backup.service', () => ({
  exportDatabaseBackup: (...args: unknown[]) => mockExportBackup(...args),
  importDatabaseBackup: (...args: unknown[]) => mockImportBackup(...args),
}));

jest.mock('@/services/cloud-sync-config.store', () => ({
  getCloudSyncLocalStatus: (...args: unknown[]) =>
    mockGetCloudLocalStatus(...args),
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
  subscribeMobileAgentActivity: (cb: (active: boolean) => void) =>
    mockSubscribeAgent(cb),
}));

jest.mock('@/runtime/novel-master-context', () => ({
  useNovelMaster: () => ({retry: mockRetry}),
}));

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => runtime,
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      text: '#111',
      textSecondary: '#666',
      success: '#34c759',
      warning: '#f80',
      danger: '#f00',
    },
  }),
}));

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
    }),
    // 近似真实 focus 行为：挂载时执行一次，卸载时跑 cleanup——真实
    // useFocusEffect 的 cleanup 同一函数同时覆盖失焦与卸载（ic-23 方案 A
    // 的「同一 cleanup」要求），此处以卸载代表离开页面。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, [cb]);
    },
    useIsFocused: () => true,
  };
});

/** 两次采样返回值：剩余条数从 100 推进到 50（搬运进行中的口径）。 */
const STATS_SNAPSHOT_A = {
  fileBytes: 1_048_576,
  reclaimableBytes: 40_960,
  blobBinary: [
    {table: 'vfsContent', done: false, pendingCount: 1100, failedCount: 0},
  ],
  messageCompaction: {done: false, pendingCount: 100},
};
const STATS_SNAPSHOT_B = {
  fileBytes: 1_048_576,
  reclaimableBytes: 40_960,
  blobBinary: [
    {table: 'vfsContent', done: false, pendingCount: 550, failedCount: 0},
  ],
  messageCompaction: {done: false, pendingCount: 50},
};

/** 收集渲染树上的全部文本节点（宿主 Text 的 children）。 */
function collectText(node: unknown): string[] {
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectText);
  }
  if (node && typeof node === 'object' && 'children' in node) {
    return collectText((node as {children: unknown}).children);
  }
  return [];
}

describe('StorageConfigScreen 维护指标轮询（ic-23）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetStats.mockReset();
    mockGetCloudLocalStatus.mockReset().mockResolvedValue({configured: false});
    mockAgentActive.mockReset().mockReturnValue(false);
    mockSubscribeAgent.mockReset().mockReturnValue(jest.fn());
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('聚焦期间 5s 轮询重采样：advance timer 后剩余条数更新', async () => {
    mockGetStats
      .mockResolvedValueOnce(STATS_SNAPSHOT_A)
      .mockResolvedValue(STATS_SNAPSHOT_B);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<StorageConfigScreen />);
    });
    // 进页快照：剩余 100 条
    expect(collectText(renderer.toJSON()).join('\n')).toContain(
      '进行中（剩余 100 条）',
    );
    expect(mockGetStats).toHaveBeenCalledTimes(1);

    // 5s 后轮询触发第二次采样，UI 值更新为 50
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    expect(mockGetStats).toHaveBeenCalledTimes(2);
    expect(collectText(renderer.toJSON()).join('\n')).toContain(
      '进行中（剩余 50 条）',
    );

    await act(async () => {
      renderer.unmount();
    });
  });

  it('失焦/卸载后 interval 被清：离开页面不再空转采样', async () => {
    mockGetStats
      .mockResolvedValueOnce(STATS_SNAPSHOT_A)
      .mockResolvedValue(STATS_SNAPSHOT_B);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<StorageConfigScreen />);
    });
    expect(mockGetStats).toHaveBeenCalledTimes(1);

    // 卸载（近似失焦，同一 cleanup）：interval 应被 clearInterval
    await act(async () => {
      renderer.unmount();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(mockGetStats).toHaveBeenCalledTimes(1);
  });
});
