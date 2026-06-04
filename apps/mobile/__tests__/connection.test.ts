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
