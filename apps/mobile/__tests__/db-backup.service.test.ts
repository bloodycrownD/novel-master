import {
  exportDatabaseBackup,
  exportDatabaseBackupToPath,
  importDatabaseBackup,
  importDatabaseBackupFromBytes,
  importDatabaseBackupFromPath,
} from '../src/services/db-backup.service';

const mockCheckpoint = jest.fn();
const mockClose = jest.fn();
const mockGetConnection = jest.fn();
const mockGetPath = jest.fn();
const mockCp = jest.fn();
const mockExists = jest.fn();
const mockUnlink = jest.fn();
const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();
const mockSaveDocuments = jest.fn();
const mockPick = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockAgentActive = jest.fn();
const mockDumpSnapshot = jest.fn();
const mockScrubInDatabase = jest.fn();
const mockRestoreSnapshot = jest.fn();
const mockOpen = jest.fn();
const mockRestoreConnClose = jest.fn();

const liveConn = {tag: 'live'};
const restoreConn = {close: mockRestoreConnClose};

jest.mock('@novel-master/core', () => ({
  dumpProviderTableSnapshot: (...args: unknown[]) => mockDumpSnapshot(...args),
  scrubProviderTablesInDatabase: (...args: unknown[]) =>
    mockScrubInDatabase(...args),
  restoreProviderTableSnapshot: (...args: unknown[]) =>
    mockRestoreSnapshot(...args),
  open: (...args: unknown[]) => mockOpen(...args),
}));

jest.mock('@novel-master/tdbc-driver-rn/native', () => ({
  registerRnDriver: jest.fn(),
}));

jest.mock('../src/db/connection', () => ({
  checkpointMobileDatabase: (...args: unknown[]) => mockCheckpoint(...args),
  closeMobileConnection: (...args: unknown[]) => mockClose(...args),
  getMobileConnection: (...args: unknown[]) => mockGetConnection(...args),
}));

jest.mock('../src/db/db-file-path', () => ({
  resolveMobileDatabaseFilePath: (...args: unknown[]) => mockGetPath(...args),
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
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
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
const emptySnapshot = {
  sksp_secrets: [],
  llm_provider: [],
  llm_saved_model: [],
};

describe('db-backup.service', () => {
  const runtime = {conn: liveConn} as never;
  const onRebootstrap = jest.fn();

  beforeEach(() => {
    mockCheckpoint.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockGetConnection.mockReset().mockResolvedValue(liveConn);
    mockGetPath.mockReset().mockResolvedValue('/db/novel_master_vfs');
    mockCp.mockReset().mockResolvedValue(undefined);
    mockExists.mockReset().mockResolvedValue(true);
    mockUnlink.mockReset().mockResolvedValue(undefined);
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockReadFile.mockReset().mockResolvedValue(SQLITE_HEADER_BASE64);
    mockSaveDocuments.mockReset().mockResolvedValue([{}]);
    mockPick.mockReset();
    mockKeepLocalCopy.mockReset();
    mockAgentActive.mockReset().mockReturnValue(false);
    mockDumpSnapshot.mockReset().mockResolvedValue(emptySnapshot);
    mockScrubInDatabase.mockReset().mockResolvedValue(undefined);
    mockRestoreSnapshot.mockReset().mockResolvedValue(undefined);
    mockOpen.mockReset().mockResolvedValue(restoreConn);
    mockRestoreConnClose.mockReset().mockResolvedValue(undefined);
    onRebootstrap.mockReset();
  });

  it('export calls checkpoint, copies db, and scrubs provider tables on copy', async () => {
    await exportDatabaseBackup(runtime);

    expect(mockCheckpoint).toHaveBeenCalledWith(liveConn);
    expect(mockGetPath).toHaveBeenCalled();
    const tmpPath = expect.stringMatching(
      /\/cache\/novel-master-backup-\d+\.nmbackup/,
    );
    expect(mockCp).toHaveBeenCalledWith('/db/novel_master_vfs', tmpPath);
    expect(mockScrubInDatabase).toHaveBeenCalledWith(
      liveConn,
      expect.stringMatching(/\/cache\/novel-master-backup-\d+\.nmbackup/),
      'export_db',
    );
    expect(mockSaveDocuments).toHaveBeenCalled();
  });

  it('rejects export when agent is running', async () => {
    mockAgentActive.mockReturnValue(true);
    await expect(exportDatabaseBackup(runtime)).rejects.toThrow(/Agent/);
    expect(mockCheckpoint).not.toHaveBeenCalled();
  });

  it('import dumps providers, replaces db, restores, then rebootstraps', async () => {
    mockPick.mockResolvedValue([{uri: 'content://backup'}]);
    mockKeepLocalCopy.mockResolvedValue([
      {status: 'success', localUri: 'file:///cache/import.nmbackup'},
    ]);

    await importDatabaseBackup(onRebootstrap);

    expect(mockDumpSnapshot).toHaveBeenCalledWith(liveConn);
    expect(mockClose).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/db/novel_master_vfs',
      expect.any(String),
      'base64',
    );
    expect(mockOpen).toHaveBeenCalled();
    expect(mockRestoreSnapshot).toHaveBeenCalledWith(
      restoreConn,
      emptySnapshot,
    );
    expect(mockRestoreConnClose).toHaveBeenCalled();
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

  it('exportDatabaseBackupToPath checkpoints, copies, and scrubs without dialog', async () => {
    const destPath = '/cache/cloud-sync-snapshot.nmbackup';
    await exportDatabaseBackupToPath(runtime, destPath);

    expect(mockCheckpoint).toHaveBeenCalledWith(liveConn);
    expect(mockGetPath).toHaveBeenCalled();
    expect(mockCp).toHaveBeenCalledWith('/db/novel_master_vfs', destPath);
    expect(mockScrubInDatabase).toHaveBeenCalledWith(
      liveConn,
      destPath,
      'export_db',
    );
    expect(mockSaveDocuments).not.toHaveBeenCalled();
  });

  it('importDatabaseBackupFromBytes dumps, replaces, restores without rebootstrap', async () => {
    const bytes = new Uint8Array(Buffer.from('SQLite format 3\0padding'));

    await importDatabaseBackupFromBytes(bytes);

    expect(mockDumpSnapshot).toHaveBeenCalledWith(liveConn);
    expect(mockClose).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/db/novel_master_vfs',
      expect.any(String),
      'base64',
    );
    expect(mockOpen).toHaveBeenCalled();
    expect(mockRestoreSnapshot).toHaveBeenCalledWith(
      restoreConn,
      emptySnapshot,
    );
    expect(mockRestoreConnClose).toHaveBeenCalled();
    expect(onRebootstrap).not.toHaveBeenCalled();
  });

  it('importDatabaseBackupFromPath uses cp instead of base64 writeFile', async () => {
    const srcPath = '/cache/import-snapshot.nmbackup';
    mockReadFile.mockResolvedValue(
      Buffer.from('SQLite format 3\0padding').toString('base64'),
    );
    mockExists.mockResolvedValue(true);

    await importDatabaseBackupFromPath(srcPath);

    expect(mockReadFile).toHaveBeenCalledWith(srcPath, 'base64', 16);
    expect(mockDumpSnapshot).toHaveBeenCalledWith(liveConn);
    expect(mockClose).toHaveBeenCalled();
    expect(mockCp).toHaveBeenCalledWith(srcPath, '/db/novel_master_vfs');
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRestoreSnapshot).toHaveBeenCalled();
  });

  it('importDatabaseBackupFromBytes rejects invalid sqlite bytes', async () => {
    const bytes = new Uint8Array(Buffer.from('not sqlite'));

    await expect(importDatabaseBackupFromBytes(bytes)).rejects.toThrow(
      /不是有效的/,
    );
    expect(mockDumpSnapshot).not.toHaveBeenCalled();
  });
});
