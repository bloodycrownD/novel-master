import {
  buildMobileDatabaseFilePathCandidates,
  clearMobileDatabaseFilePathCache,
  getMobileDatabaseFilePath,
  probeAndCacheMobileDatabaseFilePath,
  QUICK_SQLITE_DEFAULT_LOCATION,
} from '../src/db/db-file-path';
import {MOBILE_VFS_DB_NAME} from '../src/vfs/constants';

const mockExists = jest.fn();

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
