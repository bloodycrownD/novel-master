import {
  exportDatabaseBackup,
  importDatabaseBackup,
} from '../src/services/db-backup.service';

const mockCheckpoint = jest.fn();
const mockClose = jest.fn();
const mockGetPath = jest.fn();
const mockCp = jest.fn();
const mockExists = jest.fn();
const mockUnlink = jest.fn();
const mockReadFile = jest.fn();
const mockSaveDocuments = jest.fn();
const mockPick = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockAgentActive = jest.fn();

jest.mock('../src/db/connection', () => ({
  checkpointMobileDatabase: (...args: unknown[]) => mockCheckpoint(...args),
  closeMobileConnection: (...args: unknown[]) => mockClose(...args),
  getMobileDatabaseFilePath: (...args: unknown[]) => mockGetPath(...args),
}));

jest.mock('../src/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
}));

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {CacheDir: '/cache', DatabasesDir: '/db'},
      cp: (...args: unknown[]) => mockCp(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      unlink: (...args: unknown[]) => mockUnlink(...args),
      readFile: (...args: unknown[]) => mockReadFile(...args),
    },
  },
}));

jest.mock('@react-native-documents/picker', () => ({
  saveDocuments: (...args: unknown[]) => mockSaveDocuments(...args),
  pick: (...args: unknown[]) => mockPick(...args),
  keepLocalCopy: (...args: unknown[]) => mockKeepLocalCopy(...args),
  types: {allFiles: '*/*'},
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: () => false,
}));

const SQLITE_HEADER_BASE64 = Buffer.from('SQLite format 3\0').toString('base64');

describe('db-backup.service', () => {
  const runtime = {conn: {}} as never;
  const onRebootstrap = jest.fn();

  beforeEach(() => {
    mockCheckpoint.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockGetPath.mockReset().mockReturnValue('/db/novel_master_vfs');
    mockCp.mockReset().mockResolvedValue(undefined);
    mockExists.mockReset().mockResolvedValue(true);
    mockUnlink.mockReset().mockResolvedValue(undefined);
    mockReadFile.mockReset().mockResolvedValue(SQLITE_HEADER_BASE64);
    mockSaveDocuments.mockReset().mockResolvedValue([{}]);
    mockPick.mockReset();
    mockKeepLocalCopy.mockReset();
    mockAgentActive.mockReset().mockReturnValue(false);
    onRebootstrap.mockReset();
  });

  it('export calls checkpoint and copies db to cache', async () => {
    await exportDatabaseBackup(runtime);
    expect(mockCheckpoint).toHaveBeenCalledWith(runtime.conn);
    expect(mockGetPath).toHaveBeenCalled();
    expect(mockCp).toHaveBeenCalledWith(
      '/db/novel_master_vfs',
      expect.stringMatching(/\/cache\/novel-master-backup-\d+\.nmbackup/),
    );
    expect(mockSaveDocuments).toHaveBeenCalled();
  });

  it('rejects export when agent is running', async () => {
    mockAgentActive.mockReturnValue(true);
    await expect(exportDatabaseBackup(runtime)).rejects.toThrow(/Agent/);
    expect(mockCheckpoint).not.toHaveBeenCalled();
  });

  it('import closes connection, copies file, and rebootstraps', async () => {
    mockPick.mockResolvedValue([{uri: 'content://backup'}]);
    mockKeepLocalCopy.mockResolvedValue([
      {status: 'success', localUri: 'file:///cache/import.nmbackup'},
    ]);

    await importDatabaseBackup(onRebootstrap);

    expect(mockClose).toHaveBeenCalled();
    expect(mockCp).toHaveBeenCalledWith(
      '/cache/import.nmbackup',
      '/db/novel_master_vfs',
    );
    expect(onRebootstrap).toHaveBeenCalled();
  });

  it('rejects invalid sqlite file', async () => {
    mockPick.mockResolvedValue([{uri: 'content://bad'}]);
    mockKeepLocalCopy.mockResolvedValue([
      {status: 'success', localUri: 'file:///cache/bad.nmbackup'},
    ]);
    mockReadFile.mockResolvedValue(Buffer.from('not sqlite').toString('base64'));

    await expect(importDatabaseBackup(onRebootstrap)).rejects.toThrow(
      /不是有效的/,
    );
    expect(onRebootstrap).not.toHaveBeenCalled();
  });
});
