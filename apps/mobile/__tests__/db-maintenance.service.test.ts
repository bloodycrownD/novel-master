/**
 * db-maintenance.service（mobile）单测：T-DMM1 / T-DMM2。
 *
 * - T-DMM1：Agent 运行中两入口均 reject 中文错误且不触 stat/core；
 *   正常路径 getDatabaseMaintenanceStats 返回文件体积 + 可回收量、
 *   runDatabaseMaintenance 按序 stat → core 维护 → stat 返回前后体积。
 * - T-DMM2：core runDatabaseMaintenance 抛错时以 reject 语义上抛
 *   （可被调用方捕获），不吞错、错误后不再采后置体积。
 *
 * 真机 RN 环境难入 Jest，照 db-backup.service.test.ts 的全模块 mock 版式。
 */
import {
  getDatabaseMaintenanceStats,
  runDatabaseMaintenance,
} from '@/services/db-maintenance.service';

const mockGetPath = jest.fn();
const mockStat = jest.fn();
const mockAgentActive = jest.fn();
const mockGetStorageStats = jest.fn();
const mockRunMaintenance = jest.fn();
const mockCreateService = jest.fn();

const liveConn = {tag: 'live'};

jest.mock('@novel-master/core', () => ({
  createDbMaintenanceService: (...args: unknown[]) =>
    mockCreateService(...args),
}));

jest.mock('@/db/db-file-path', () => ({
  resolveMobileDatabaseFilePath: (...args: unknown[]) => mockGetPath(...args),
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {CacheDir: '/cache', DatabasesDir: '/db'},
      stat: (...args: unknown[]) => mockStat(...args),
    },
  },
}));

const STORAGE_STATS = {
  pageSize: 4096,
  pageCount: 100,
  freelistPages: 10,
  reclaimableBytes: 40960,
};

const MAINTENANCE_RESULT = {
  before: STORAGE_STATS,
  after: {
    ...STORAGE_STATS,
    pageCount: 90,
    freelistPages: 0,
    reclaimableBytes: 0,
  },
  reclaimedBytes: 40960,
};

describe('db-maintenance.service', () => {
  const runtime = {conn: liveConn} as never;

  beforeEach(() => {
    mockGetPath.mockReset().mockResolvedValue('/db/novel_master_vfs');
    mockStat.mockReset().mockResolvedValue({size: 1024});
    mockAgentActive.mockReset().mockReturnValue(false);
    mockGetStorageStats.mockReset().mockResolvedValue(STORAGE_STATS);
    mockRunMaintenance.mockReset().mockResolvedValue(MAINTENANCE_RESULT);
    mockCreateService.mockReset().mockReturnValue({
      getStorageStats: (...args: unknown[]) => mockGetStorageStats(...args),
      runDatabaseMaintenance: (...args: unknown[]) =>
        mockRunMaintenance(...args),
    });
  });

  it('T-DMM1: Agent 运行中 getDatabaseMaintenanceStats reject 中文错误且不触 stat/core', async () => {
    mockAgentActive.mockReturnValue(true);

    await expect(getDatabaseMaintenanceStats(runtime)).rejects.toThrow(
      /Agent 运行中/,
    );
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('T-DMM1: Agent 运行中 runDatabaseMaintenance reject 中文错误且不触 stat/core', async () => {
    mockAgentActive.mockReturnValue(true);

    await expect(runDatabaseMaintenance(runtime)).rejects.toThrow(
      /Agent 运行中/,
    );
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('T-DMM1: getDatabaseMaintenanceStats 正常路径返回文件体积与可回收量', async () => {
    mockStat.mockResolvedValue({size: 1048576});

    const stats = await getDatabaseMaintenanceStats(runtime);

    expect(mockStat).toHaveBeenCalledWith('/db/novel_master_vfs');
    expect(mockCreateService).toHaveBeenCalledWith(liveConn);
    expect(mockGetStorageStats).toHaveBeenCalledTimes(1);
    expect(stats).toEqual({fileBytes: 1048576, reclaimableBytes: 40960});
  });

  it('T-DMM1: runDatabaseMaintenance 正常路径 stat 前后各一次并返回前后体积', async () => {
    mockStat
      .mockResolvedValueOnce({size: 1048576})
      .mockResolvedValueOnce({size: 524288});

    const result = await runDatabaseMaintenance(runtime);

    expect(mockRunMaintenance).toHaveBeenCalledTimes(1);
    expect(mockRunMaintenance).toHaveBeenCalledWith();
    expect(mockStat).toHaveBeenCalledTimes(2);
    expect(result).toEqual({beforeBytes: 1048576, afterBytes: 524288});
  });

  it('T-DMM2: core runDatabaseMaintenance 抛错时 reject 上抛（可被调用方捕获），不吞错', async () => {
    mockRunMaintenance.mockRejectedValue(
      new Error('VACUUM failed: database is locked'),
    );
    mockStat
      .mockResolvedValueOnce({size: 1048576})
      .mockResolvedValue({size: 999999});

    // rejects.toThrow 本身证明错误以 reject 语义上抛且可被调用方捕获
    await expect(runDatabaseMaintenance(runtime)).rejects.toThrow(
      /VACUUM failed/,
    );
    // 错误中止后不再采后置体积（stat 仅前置一次）
    expect(mockStat).toHaveBeenCalledTimes(1);
  });
});
