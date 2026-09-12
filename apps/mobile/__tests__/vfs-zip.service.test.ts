import {Platform} from 'react-native';
import {
  exportVfsZip,
  importVfsZip,
  zipBaseNameFromPath,
} from '@/services/vfs-zip.service';
import {VfsZipError} from '@novel-master/core/vfs';

const mockExport = jest.fn();
const mockImport = jest.fn();
const mockCreateVfsZipIoService = jest.fn();
const mockPick = jest.fn();
const mockSaveDocuments = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();
const mockExists = jest.fn();
const mockStat = jest.fn();
const mockUnlink = jest.fn();
const mockParseVfsZip = jest.fn();
const mockProjectsGet = jest.fn();

jest.mock('@novel-master/core/vfs', () => ({
  ...jest.requireActual('@novel-master/core/vfs'),
  createVfsZipIoService: (...args: unknown[]) =>
    mockCreateVfsZipIoService(...args),
  parseVfsZip: (...args: unknown[]) => mockParseVfsZip(...args),
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
  Platform: {OS: 'android' as 'android' | 'ios'},
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

/** 含 EOCD 的最小有效 ZIP（fflate zipSync 单文件 a.md）。 */
const VALID_ZIP_BYTES = new Uint8Array([
  80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 98, 80, 205, 92, 67, 190, 183, 232, 3, 0, 0,
  0, 1, 0, 0, 0, 4, 0, 0, 0, 97, 46, 109, 100, 75, 4, 0, 80, 75, 1, 2, 20, 0,
  20, 0, 0, 0, 8, 0, 98, 80, 205, 92, 67, 190, 183, 232, 3, 0, 0, 0, 1, 0, 0, 0,
  4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 97, 46, 109, 100, 80,
  75, 5, 6, 0, 0, 0, 0, 1, 0, 1, 0, 50, 0, 0, 0, 37, 0, 0, 0, 0, 0,
]);
const VALID_ZIP_BASE64 =
  'UEsDBBQAAAAIAGJQzVxDvrfoAwAAAAEAAAAEAAAAYS5tZEsEAFBLAQIUABQAAAAIAGJQzVxDvrfoAwAAAAEAAAAEAAAAAAAAAAAAAAAAAAAAAABhLm1kUEsFBgAAAAABAAEAMgAAACUAAAAAAA==';

/** 仅有 local header、无 EOCD 的截断 ZIP。 */
const TRUNCATED_ZIP_BASE64 = 'UEsDBBQAAAAIAAAAAAAAAAAAAAAAAAAAAAA=';

describe('vfs-zip.service', () => {
  const runtime = {
    conn: {},
    projects: {get: mockProjectsGet},
  } as never;
  const scope = {kind: 'session', projectId: 'p', sessionId: 's'} as const;

  beforeEach(() => {
    Platform.OS = 'android';
    mockExport.mockReset();
    mockImport.mockReset();
    mockCreateVfsZipIoService.mockReset();
    mockPick.mockReset();
    mockSaveDocuments.mockReset();
    mockKeepLocalCopy.mockReset();
    mockWriteFile.mockReset();
    mockReadFile.mockReset();
    mockExists.mockReset();
    mockStat.mockReset();
    mockUnlink.mockReset();
    mockParseVfsZip.mockReset();
    mockProjectsGet.mockReset().mockResolvedValue({id: 'p', name: '我的项目'});
    mockCreateVfsZipIoService.mockReturnValue({
      export: mockExport,
      import: mockImport,
    });
    mockExport.mockResolvedValue(VALID_ZIP_BYTES);
    mockSaveDocuments.mockResolvedValue([
      {uri: 'content://saved', name: 'x.zip', error: null},
    ]);
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({size: 5});
    mockUnlink.mockResolvedValue(undefined);
    mockParseVfsZip.mockReturnValue(new Map([['a.md', new Uint8Array([97])]]));
    mockKeepLocalCopy.mockResolvedValue([
      {
        status: 'success',
        localUri: 'file:///cache/import.zip',
        sourceUri: 'content://picked',
      },
    ]);
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(VALID_ZIP_BASE64);
  });

  it('Android export uses Core default createVfsZipIoService(conn)', async () => {
    await exportVfsZip(runtime, scope);
    expect(mockCreateVfsZipIoService).toHaveBeenCalledTimes(1);
    expect(mockCreateVfsZipIoService).toHaveBeenCalledWith(runtime.conn);
    expect(mockCreateVfsZipIoService.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('iOS export uses Core default createVfsZipIoService(conn)', async () => {
    Platform.OS = 'ios';
    await exportVfsZip(runtime, scope);
    expect(mockCreateVfsZipIoService).toHaveBeenCalledTimes(1);
    expect(mockCreateVfsZipIoService).toHaveBeenCalledWith(runtime.conn);
    expect(mockCreateVfsZipIoService.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('writes cache zip then opens save-as dialog', async () => {
    const result = await exportVfsZip(runtime, scope);
    expect(result).toBe('saved');
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/cache/我的项目.zip',
      expect.any(String),
      'base64',
    );
    expect(mockSaveDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUris: ['file:///cache/我的项目.zip'],
        mimeType: 'application/zip',
        fileName: '我的项目.zip',
        copy: true,
      }),
    );
    expect(mockUnlink).toHaveBeenCalledWith('/cache/我的项目.zip');
  });

  it('surfaces VfsZipError from gather without retry', async () => {
    const vfsErr = new VfsZipError(
      'EXTERNAL_NOT_SUPPORTED',
      'external storage not supported',
    );
    mockExport.mockRejectedValue(vfsErr);

    await expect(exportVfsZip(runtime, scope)).rejects.toThrow(
      'external storage not supported',
    );

    expect(mockCreateVfsZipIoService).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled when save-as dialog dismissed', async () => {
    mockSaveDocuments.mockRejectedValue({code: 'OPERATION_CANCELED'});
    const result = await exportVfsZip(runtime, scope);
    expect(result).toBe('cancelled');
  });

  it('import rejects truncated ZIP missing EOCD', async () => {
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/bad.zip', name: 'bad.zip'},
    ]);
    mockReadFile.mockResolvedValue(TRUNCATED_ZIP_BASE64);

    await expect(
      importVfsZip(runtime, scope, {confirmed: true}),
    ).rejects.toMatchObject({
      code: 'INVALID_ZIP',
      message: expect.stringContaining('missing EOCD'),
    });
    expect(mockImport).not.toHaveBeenCalled();
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
    expect(mockImport).toHaveBeenCalledWith(scope, expect.any(Uint8Array), {
      confirmed: true,
      directoryPath: '/',
    });
  });

  it('passes directoryPath to Core export/import', async () => {
    await exportVfsZip(runtime, scope, {directoryPath: '/a'});
    expect(mockExport).toHaveBeenCalledWith(scope, {directoryPath: '/a'});

    mockPick.mockResolvedValue([
      {uri: 'content://downloads/x.zip', name: 'x.zip'},
    ]);
    await importVfsZip(runtime, scope, {
      confirmed: true,
      directoryPath: '/a',
    });
    expect(mockImport).toHaveBeenCalledWith(scope, expect.any(Uint8Array), {
      confirmed: true,
      directoryPath: '/a',
    });
  });

  it('export 默认名取子目录末段（与 Desktop 同规则）', async () => {
    await exportVfsZip(runtime, scope, {directoryPath: '/a/b'});
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/cache/b.zip',
      expect.any(String),
      'base64',
    );
    expect(mockSaveDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUris: ['file:///cache/b.zip'],
        fileName: 'b.zip',
      }),
    );
    // 子目录命名不依赖项目解析
    expect(mockProjectsGet).not.toHaveBeenCalled();
  });

  it('fileName 覆盖优先于路径与项目名推导', async () => {
    await exportVfsZip(runtime, scope, {
      directoryPath: '/a/b',
      fileName: '技能包.zip',
    });
    expect(mockSaveDocuments).toHaveBeenCalledWith(
      expect.objectContaining({fileName: '技能包.zip'}),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/cache/技能包.zip',
      expect.any(String),
      'base64',
    );
  });

  it('根目录导出项目解析失败回退 workspace.zip', async () => {
    mockProjectsGet.mockRejectedValue(new Error('project not found'));
    await exportVfsZip(runtime, scope);
    expect(mockSaveDocuments).toHaveBeenCalledWith(
      expect.objectContaining({fileName: 'workspace.zip'}),
    );
  });

  it('无 projectId 域的根目录导出回退 workspace.zip', async () => {
    await exportVfsZip(runtime, {kind: 'global-meta'} as const);
    expect(mockProjectsGet).not.toHaveBeenCalled();
    expect(mockSaveDocuments).toHaveBeenCalledWith(
      expect.objectContaining({fileName: 'workspace.zip'}),
    );
  });

  it('zipBaseNameFromPath：根→null，子目录→末段，文件→文件名', () => {
    expect(zipBaseNameFromPath('/')).toBeNull();
    expect(zipBaseNameFromPath('')).toBeNull();
    expect(zipBaseNameFromPath('/设定集')).toBe('设定集');
    expect(zipBaseNameFromPath('/设定集/大纲')).toBe('大纲');
    // 文件目标口径：末段即文件名，追加 .zip
    expect(zipBaseNameFromPath('/notes/资料.md')).toBe('资料.md');
    // 尾斜杠归一化到目录名
    expect(zipBaseNameFromPath('/设定集/')).toBe('设定集');
  });

  it('skips import when picker cancelled', async () => {
    mockPick.mockResolvedValue([]);
    await importVfsZip(runtime, scope, {confirmed: true});
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    expect(mockImport).not.toHaveBeenCalled();
  });
});
