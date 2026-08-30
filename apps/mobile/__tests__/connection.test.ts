import {
  buildMobileDatabaseFilePathCandidates,
  clearMobileDatabaseFilePathCache,
  getMobileDatabaseFilePath,
  probeAndCacheMobileDatabaseFilePath,
  QUICK_SQLITE_DEFAULT_LOCATION,
} from '@/db/db-file-path';
import {closeMobileConnection, getMobileConnection} from '@/db/connection';
import {MOBILE_VFS_DB_NAME} from '@/vfs/constants';

const mockExists = jest.fn();
const mockOpen = jest.fn();
const mockBootstrap = jest.fn();

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {
        DocumentDir: '/data/files',
        LibraryDir: '/data/library',
      },
      exists: (...args: unknown[]) => mockExists(...args),
    },
  },
}));

jest.mock('@novel-master/core', () => ({
  open: (...args: unknown[]) => mockOpen(...args),
  bootstrapNovelMaster: (...args: unknown[]) => mockBootstrap(...args),
}));

jest.mock('@novel-master/tdbc-driver-op-sqlite/native', () => ({
  registerOpSqliteDriver: jest.fn(),
}));

jest.mock('@novel-master/sksp-android', () => ({
  registerSkspAndroidDriver: jest.fn(),
}));

jest.mock('@novel-master/tokenizer-driver-rn/native', () => ({
  registerTokenizerRnDriver: jest.fn(),
}));

describe('mobile database file path', () => {
  beforeEach(() => {
    clearMobileDatabaseFilePathCache();
    mockExists.mockReset();
  });

  it('builds quick-sqlite default layout under DocumentDir', () => {
    expect(buildMobileDatabaseFilePathCandidates()).toContain(
      `/data/files/${QUICK_SQLITE_DEFAULT_LOCATION}/${MOBILE_VFS_DB_NAME}`,
    );
    expect(buildMobileDatabaseFilePathCandidates()).toContain(
      `/data/files/${QUICK_SQLITE_DEFAULT_LOCATION}/${MOBILE_VFS_DB_NAME}.db`,
    );
    expect(buildMobileDatabaseFilePathCandidates()).toContain(
      `/data/files/${MOBILE_VFS_DB_NAME}`,
    );
  });

  it('builds op-sqlite default layout under Android databases dir', () => {
    // Android 上 op-sqlite 默认把库落在 files 的兄弟 databases 目录，
    // 文件名不带 .db 后缀；.db 变体作为候选一并保留。
    const candidates = buildMobileDatabaseFilePathCandidates();
    expect(candidates).toContain(`/data/databases/${MOBILE_VFS_DB_NAME}`);
    expect(candidates).toContain(`/data/databases/${MOBILE_VFS_DB_NAME}.db`);
  });

  it('keeps quick-sqlite candidates ahead of op-sqlite ones', () => {
    // 驱动层对旧布局绝对路径优先打开，探测顺序要保持一致，
    // 备份拷贝的目标才不会和驱动实际打开的文件错开。
    const candidates = buildMobileDatabaseFilePathCandidates();
    const legacyIndex = candidates.indexOf(
      `/data/files/${QUICK_SQLITE_DEFAULT_LOCATION}/${MOBILE_VFS_DB_NAME}`,
    );
    const opSqliteIndex = candidates.indexOf(
      `/data/databases/${MOBILE_VFS_DB_NAME}`,
    );
    expect(legacyIndex).toBeGreaterThanOrEqual(0);
    expect(opSqliteIndex).toBeGreaterThan(legacyIndex);
  });

  it('probe falls back to op-sqlite layout when legacy files absent', async () => {
    mockExists.mockImplementation(
      async (path: string) => path === `/data/databases/${MOBILE_VFS_DB_NAME}`,
    );
    const path = await probeAndCacheMobileDatabaseFilePath();
    expect(path).toBe(`/data/databases/${MOBILE_VFS_DB_NAME}`);
    expect(getMobileDatabaseFilePath()).toBe(path);
  });

  it('getMobileDatabaseFilePath uses default layout without DatabasesDir', () => {
    expect(getMobileDatabaseFilePath()).toBe(
      `/data/files/${QUICK_SQLITE_DEFAULT_LOCATION}/${MOBILE_VFS_DB_NAME}`,
    );
  });

  it('probeAndCacheMobileDatabaseFilePath picks first existing candidate', async () => {
    mockExists.mockImplementation(async (path: string) =>
      path.endsWith(`${MOBILE_VFS_DB_NAME}.db`),
    );
    const path = await probeAndCacheMobileDatabaseFilePath();
    expect(path).toBe(
      `/data/files/${QUICK_SQLITE_DEFAULT_LOCATION}/${MOBILE_VFS_DB_NAME}.db`,
    );
    expect(getMobileDatabaseFilePath()).toBe(path);
  });
});

describe('getMobileConnection bootstrap failure', () => {
  beforeEach(() => {
    mockExists.mockReset();
    mockOpen.mockReset();
    mockBootstrap.mockReset();
    // 失败路径会打 cause 链日志，测试里不需要真输出。
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // 重置 connection 模块的 conn / initPromise，避免状态串到其他用例。
    await closeMobileConnection();
  });

  it('closes the opened connection when bootstrap rejects, and reopen works after reset', async () => {
    // bootstrap 抛错时 conn 尚未赋值，closeMobileConnection() 关不到这条
    // 连接；open 拿到的连接必须在意料外的路径上被手动 close，否则文件
    // 句柄和 WAL 锁泄漏，Android 重试 open 同一个库时可能互锁。
    const leakingConn = {close: jest.fn().mockResolvedValue(undefined)};
    mockOpen.mockResolvedValueOnce(leakingConn);
    mockBootstrap.mockRejectedValueOnce(new Error('bootstrap boom'));

    await expect(getMobileConnection()).rejects.toThrow('bootstrap boom');
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(leakingConn.close).toHaveBeenCalledTimes(1);

    // 重试路径：bootstrap 失败后 initPromise 仍是那个 rejected 的 Promise，
    // 直接重调不会重新 open；实际重试要先 closeMobileConnection() 重置
    // initPromise，再重新走 open。
    await closeMobileConnection();
    const retryConn = {close: jest.fn().mockResolvedValue(undefined)};
    mockOpen.mockResolvedValueOnce(retryConn);
    mockBootstrap.mockResolvedValueOnce(undefined);

    await expect(getMobileConnection()).resolves.toBe(retryConn);
    expect(mockOpen).toHaveBeenCalledTimes(2);
    expect(retryConn.close).not.toHaveBeenCalled();
  });
});
