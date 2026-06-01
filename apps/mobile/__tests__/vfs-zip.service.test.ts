import {exportVfsZip, importVfsZip} from '../src/services/vfs-zip.service';

const mockExport = jest.fn();
const mockImport = jest.fn();
const mockPick = jest.fn();
const mockSaveDocuments = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();
const mockExists = jest.fn();
const mockStat = jest.fn();
const mockUnlink = jest.fn();
const mockParseVfsZip = jest.fn();

jest.mock('@novel-master/core', () => ({
  createVfsZipIoService: () => ({
    export: mockExport,
    import: mockImport,
  }),
  parseVfsZip: (...args: unknown[]) => mockParseVfsZip(...args),
  VfsZipError: class VfsZipError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'VfsZipError';
      this.code = code;
    }
  },
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  saveDocuments: (...args: unknown[]) => mockSaveDocuments(...args),
  keepLocalCopy: (...args: unknown[]) => mockKeepLocalCopy(...args),
  types: {zip: 'application/zip'},
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: (err: unknown) =>
    typeof err === 'object' &&
    err != null &&
    'code' in err &&
    (err as {code: string}).code === 'OPERATION_CANCELED',
}));

jest.mock('react-native', () => ({
  Platform: {OS: 'android'},
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {CacheDir: '/cache'},
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      readFile: (...args: unknown[]) => mockReadFile(...args),
      exists: (...args: unknown[]) => mockExists(...args),
      stat: (...args: unknown[]) => mockStat(...args),
      unlink: (...args: unknown[]) => mockUnlink(...args),
    },
  },
}));

/** Minimal ZIP local file header (PK\\x03\\x04) + stub payload for magic checks. */
const ZIP_PK_BASE64 = 'UEsDBBQAAAAIAAAAAAAAAAAAAAAAAAAAAAA=';

describe('vfs-zip.service', () => {
  const runtime = {conn: {}} as never;
  const scope = {kind: 'session', projectId: 'p', sessionId: 's'} as const;

  beforeEach(() => {
    mockExport.mockReset();
    mockImport.mockReset();
    mockPick.mockReset();
    mockSaveDocuments.mockReset();
    mockKeepLocalCopy.mockReset();
    mockWriteFile.mockReset();
    mockReadFile.mockReset();
    mockExists.mockReset();
    mockStat.mockReset();
    mockUnlink.mockReset();
    mockParseVfsZip.mockReset();
    mockExport.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]));
    mockSaveDocuments.mockResolvedValue([
      {uri: 'content://saved', name: 'x.zip', error: null},
    ]);
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({size: 5});
    mockUnlink.mockResolvedValue(undefined);
    mockParseVfsZip.mockReturnValue(
      new Map([['a.md', new Uint8Array([97])]]),
    );
    mockKeepLocalCopy.mockResolvedValue([
      {
        status: 'success',
        localUri: 'file:///cache/import.zip',
        sourceUri: 'content://picked',
      },
    ]);
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(ZIP_PK_BASE64);
  });

  it('writes cache zip then opens save-as dialog', async () => {
    const result = await exportVfsZip(runtime, scope);
    expect(result).toBe('saved');
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/cache/vfs-session-s.zip',
      expect.any(String),
      'base64',
    );
    expect(mockSaveDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUris: ['file:///cache/vfs-session-s.zip'],
        mimeType: 'application/zip',
        fileName: 'vfs-session-s.zip',
      }),
    );
    expect(mockUnlink).toHaveBeenCalledWith('/cache/vfs-session-s.zip');
  });

  it('returns cancelled when save-as dialog dismissed', async () => {
    mockSaveDocuments.mockRejectedValue({code: 'OPERATION_CANCELED'});
    const result = await exportVfsZip(runtime, scope);
    expect(result).toBe('cancelled');
  });

  it('imports via keepLocalCopy and blob read', async () => {
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/x.zip', name: 'x.zip'},
    ]);
    await importVfsZip(runtime, scope, {confirmed: true});
    expect(mockKeepLocalCopy).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [{uri: 'content://downloads/x.zip', fileName: 'import.zip'}],
        destination: 'cachesDirectory',
      }),
    );
    expect(mockReadFile).toHaveBeenCalledWith('/cache/import.zip', 'base64');
    expect(mockImport).toHaveBeenCalledWith(
      scope,
      expect.any(Uint8Array),
      {confirmed: true},
    );
  });

  it('skips import when picker cancelled', async () => {
    mockPick.mockResolvedValue([]);
    await importVfsZip(runtime, scope, {confirmed: true});
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    expect(mockImport).not.toHaveBeenCalled();
  });
});
