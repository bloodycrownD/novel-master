/**
 * db-maintenance.service（mobile）单测：T-DMM1 / T-DMM2。
 *
 * - T-DMM1：Agent 运行中两入口均 reject 中文错误且不触 stat/core；
 *   正常路径 getDbMaintenanceStats 返回文件体积 + 可回收量，
 *   runDbMaintenance 按序 stat → core 维护 → stat 返回前后体积。
 * - T-DMM2：core runDatabaseMaintenance 抛错时以 reject 语义上抛
 *   （可被调用方捕获），不吞错、错误后不再采后置体积。
 *
 * 存量 blob 归一与 VFS 历史版本打包状态透传的用例（T-BB-S / cr-04 /
 * T-VP22）已随第七轮退役删除（v1.5.41 同批，任务本体一并出列）。
 *
 * 真机 RN 环境难入 Jest，照 db-backup.service.test.ts 的全模块 mock 版式。
 */
import {AbortRegistryFactory} from '@novel-master/core/abort';
import {
  getDbMaintenanceStats,
  runDbMaintenance,
} from '@/services/db-maintenance.service';

const mockGetPath = jest.fn();
const mockStat = jest.fn();
const mockAgentActive = jest.fn();
const mockGetStorageStats = jest.fn();
const mockRunMaintenance = jest.fn();
const mockCreateService = jest.fn();

const liveConn = {tag: 'live'};

jest.mock('@novel-master/core', () => ({
  DbMaintenance: {create: (...args: unknown[]) => mockCreateService(...args)},
}));

jest.mock('@/db/db-file-path', () => ({
  resolveMobileDatabaseFilePath: (...args: unknown[]) => mockGetPath(...args),
}));

jest.mock('@/runtime/agent-activity', () => ({
  agentActivity: {isActive: () => mockAgentActive()},
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
  // signal-abort-scope Step 11：runDatabaseMaintenance 会建 scope 并登记
  // dbMaintenance("local")，测试桩必须提供泛化 registry。
  const runtime = {conn: liveConn, abortRegistry: AbortRegistryFactory.create()} as never;

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

  it('T-DMM1: Agent 运行中 getDbMaintenanceStats reject 中文错误且不触 stat/core', async () => {
    mockAgentActive.mockReturnValue(true);

    // 四期签名：已知失败沿 Result.err 回传（中文文案在 detail），不再 reject。
    const stats = await getDbMaintenanceStats(runtime);
    expect(stats.ok).toBe(false);
    if (!stats.ok) {
      expect(stats.error.message).toMatch(/Agent 运行中/);
    }
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('T-DMM1: Agent 运行中 runDbMaintenance reject 中文错误且不触 stat/core', async () => {
    mockAgentActive.mockReturnValue(true);

    // 四期签名：已知失败沿 Result.err 回传（中文文案在 detail），不再 reject。
    const result = await runDbMaintenance(runtime);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/Agent 运行中/);
    }
    expect(mockStat).not.toHaveBeenCalled();
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('T-DMM1: getDbMaintenanceStats 正常路径返回文件体积与可回收量', async () => {
    mockStat.mockResolvedValue({size: 1048576});

    const stats = await getDbMaintenanceStats(runtime);

    expect(mockStat).toHaveBeenCalledWith('/db/novel_master_vfs');
    expect(mockCreateService).toHaveBeenCalledWith(liveConn);
    expect(mockGetStorageStats).toHaveBeenCalledTimes(1);
    // 四期签名：成功值在 Result.value 里。
    expect(stats).toEqual({
      ok: true,
      value: {
        fileBytes: 1048576,
        reclaimableBytes: 40960,
      },
    });
  });

  it('T-DMM1: runDbMaintenance 正常路径 stat 前后各一次并返回前后体积', async () => {
    mockStat
      .mockResolvedValueOnce({size: 1048576})
      .mockResolvedValueOnce({size: 524288});

    const result = await runDbMaintenance(runtime);

    expect(mockRunMaintenance).toHaveBeenCalledTimes(1);
    expect(mockRunMaintenance).toHaveBeenCalledWith();
    expect(mockStat).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      value: {beforeBytes: 1048576, afterBytes: 524288},
    });
  });

  it('T-DMM2: core runDatabaseMaintenance 抛错时 reject 上抛（可被调用方捕获），不吞错', async () => {
    // 矩阵归属：spec T-DMM2 的「库仍可正常读写」由 SQLite VACUUM 原子性 +
    // core T-DM 系列（packages/core/test/infra/db-maintenance.test.ts）承接；
    // mobile 侧照 db-backup.service.test.ts 的全模块 mock 版式，不重复断言。
    mockRunMaintenance.mockRejectedValue(
      new Error('VACUUM failed: database is locked'),
    );
    mockStat
      .mockResolvedValueOnce({size: 1048576})
      .mockResolvedValue({size: 999999});

    // rejects.toThrow 本身证明错误以 reject 语义上抛且可被调用方捕获
    await expect(runDbMaintenance(runtime)).rejects.toThrow(
      /VACUUM failed/,
    );
    // 错误中止后不再采后置体积（stat 仅前置一次）
    expect(mockStat).toHaveBeenCalledTimes(1);
  });
});
