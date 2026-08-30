/**
 * document-io：导出/导入文档编排的统一层单测。
 *
 * 重点覆盖：临时文件在取消/失败分支也会 unlink（不留脏文件）、
 * keepLocalCopy 落盘名的固定/兜底语义、错误映射回调。
 */
const mockPick = jest.fn();
const mockSaveDocuments = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockIsKnownType = jest.fn();
const mockExists = jest.fn();
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockUnlink = jest.fn();

jest.mock('@react-native-documents/picker', () => ({
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: (error: unknown): boolean =>
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    (error as {code: unknown}).code === 'OPERATION_CANCELED',
  isKnownType: (...args: unknown[]) => mockIsKnownType(...args),
  pick: (...args: unknown[]) => mockPick(...args),
  saveDocuments: (...args: unknown[]) => mockSaveDocuments(...args),
  keepLocalCopy: (...args: unknown[]) => mockKeepLocalCopy(...args),
}));

jest.mock('react-native-blob-util', () => ({
  fs: {
    dirs: {CacheDir: '/cache'},
    exists: (...args: unknown[]) => mockExists(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

import {
  exportBytesViaDocumentPicker,
  knownTypesForExtension,
  pickAndReadBytes,
  pickAndReadText,
  pickToLocalPath,
} from '@/services/document-io';

describe('document-io', () => {
  beforeEach(() => {
    mockPick.mockReset();
    mockSaveDocuments.mockReset();
    mockKeepLocalCopy.mockReset();
    mockIsKnownType.mockReset();
    mockExists.mockReset();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockUnlink.mockReset().mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockSaveDocuments.mockResolvedValue([
      {uri: 'content://saved', error: null},
    ]);
    mockExists.mockResolvedValue(true);
  });

  describe('exportBytesViaDocumentPicker', () => {
    it('先写临时文件再弹保存 UI，成功后清理临时文件', async () => {
      const result = await exportBytesViaDocumentPicker({
        fileName: 'a.zip',
        mimeType: 'application/zip',
        write: async tmpPath => {
          expect(tmpPath).toBe('/cache/a.zip');
          await mockWriteFile(tmpPath, 'payload', 'base64');
        },
      });

      expect(result).toBe('saved');
      expect(mockSaveDocuments).toHaveBeenCalledWith({
        sourceUris: ['file:///cache/a.zip'],
        mimeType: 'application/zip',
        fileName: 'a.zip',
        copy: true,
      });
      expect(mockUnlink).toHaveBeenCalledWith('/cache/a.zip');
    });

    it('用户取消返回 cancelled 且临时文件仍被 unlink（无残留）', async () => {
      mockSaveDocuments.mockRejectedValue({code: 'OPERATION_CANCELED'});

      const result = await exportBytesViaDocumentPicker({
        fileName: 'a.zip',
        mimeType: 'application/zip',
        write: async () => undefined,
      });

      expect(result).toBe('cancelled');
      expect(mockUnlink).toHaveBeenCalledWith('/cache/a.zip');
    });

    it('saveDocuments 返回 error 条目时抛错并清理临时文件', async () => {
      mockSaveDocuments.mockResolvedValue([{error: 'disk full'}]);

      await expect(
        exportBytesViaDocumentPicker({
          fileName: 'a.zip',
          mimeType: 'application/zip',
          write: async () => undefined,
        }),
      ).rejects.toThrow('disk full');
      expect(mockUnlink).toHaveBeenCalledWith('/cache/a.zip');
    });

    it('copy 选项透传（备份在 Android 传 false）', async () => {
      await exportBytesViaDocumentPicker({
        fileName: 'b.nmbackup',
        mimeType: 'application/octet-stream',
        copy: false,
        write: async () => undefined,
      });
      expect(mockSaveDocuments).toHaveBeenCalledWith(
        expect.objectContaining({copy: false}),
      );
    });
  });

  describe('pickToLocalPath / pickAndReadBytes', () => {
    it('pick → keepLocalCopy → 解码中文 localUri 为 fs 路径', async () => {
      mockPick.mockResolvedValue([
        {uri: 'content://x', name: '%E6%88%91.yaml'},
      ]);
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'success', localUri: 'file:///cache/%E4%B8%AD%E6%96%87.yaml'},
      ]);

      const picked = await pickToLocalPath({
        mimeTypes: ['text/yaml'],
        fallbackLocalFileName: 'yaml-import.yaml',
      });

      expect(picked?.fsPath).toBe('/cache/中文.yaml');
      expect(mockKeepLocalCopy).toHaveBeenCalledWith({
        files: [{uri: 'content://x', fileName: '%E6%88%91.yaml'}],
        destination: 'cachesDirectory',
      });
    });

    it('localFileName 固定落盘名覆盖所选项自带名', async () => {
      mockPick.mockResolvedValue([{uri: 'content://x', name: 'whatever.zip'}]);
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'success', localUri: 'file:///cache/import.zip'},
      ]);

      await pickToLocalPath({
        mimeTypes: ['application/zip'],
        localFileName: 'import.zip',
      });

      expect(mockKeepLocalCopy).toHaveBeenCalledWith({
        files: [{uri: 'content://x', fileName: 'import.zip'}],
        destination: 'cachesDirectory',
      });
    });

    it('用户取消返回 null 且不触发 keepLocalCopy', async () => {
      mockPick.mockResolvedValue([]);

      await expect(
        pickAndReadBytes({mimeTypes: ['application/zip']}),
      ).resolves.toBeNull();
      expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    });

    it('assertFileName 抛错时中止且不拷贝', async () => {
      mockPick.mockResolvedValue([{uri: 'content://x', name: 'a.txt'}]);

      await expect(
        pickToLocalPath({
          mimeTypes: ['text/plain'],
          assertFileName: () => {
            throw new Error('请选择 .yaml 文件');
          },
        }),
      ).rejects.toThrow('请选择 .yaml 文件');
      expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    });

    it('keepLocalCopy 失败走 buildCopyError 映射', async () => {
      mockPick.mockResolvedValue([{uri: 'content://x', name: 'a.zip'}]);
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'error', copyError: 'no space'},
      ]);

      await expect(
        pickAndReadBytes({
          mimeTypes: ['application/zip'],
          buildCopyError: msg => new Error(`zip copy failed: ${msg}`),
        }),
      ).rejects.toThrow('zip copy failed: no space');
    });

    it('读字节：exists 检查 + base64 解码', async () => {
      mockPick.mockResolvedValue([{uri: 'content://x', name: 'a.zip'}]);
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'success', localUri: 'file:///cache/a.zip'},
      ]);
      mockReadFile.mockResolvedValue(globalThis.btoa('hi'));

      const bytes = await pickAndReadBytes({mimeTypes: ['application/zip']});

      expect(mockReadFile).toHaveBeenCalledWith('/cache/a.zip', 'base64');
      expect(bytes).toEqual(new Uint8Array([0x68, 0x69]));
    });

    it('本地文件不存在时走 buildMissingError 映射', async () => {
      mockPick.mockResolvedValue([{uri: 'content://x', name: 'a.zip'}]);
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'success', localUri: 'file:///cache/a.zip'},
      ]);
      mockExists.mockResolvedValue(false);

      await expect(
        pickAndReadBytes({
          mimeTypes: ['application/zip'],
          buildMissingError: fsPath => new Error(`missing: ${fsPath}`),
        }),
      ).rejects.toThrow('missing: /cache/a.zip');
    });

    it('pickAndReadText 以 utf8 读出文本', async () => {
      mockPick.mockResolvedValue([{uri: 'content://x', name: 'a.yaml'}]);
      mockKeepLocalCopy.mockResolvedValue([
        {status: 'success', localUri: 'file:///cache/a.yaml'},
      ]);
      mockReadFile.mockResolvedValue('name: a');

      await expect(pickAndReadText({mimeTypes: ['text/yaml']})).resolves.toBe(
        'name: a',
      );
      expect(mockReadFile).toHaveBeenCalledWith('/cache/a.yaml', 'utf8');
    });
  });

  describe('knownTypesForExtension', () => {
    it('返回 isKnownType 的 MIME', () => {
      mockIsKnownType.mockReturnValue({mimeType: 'image/png'});
      expect(knownTypesForExtension('png')).toEqual(['image/png']);
    });

    it('mimeType 缺失或抛错时返回空数组', () => {
      mockIsKnownType.mockReturnValueOnce({mimeType: null});
      mockIsKnownType.mockImplementationOnce(() => {
        throw new Error('unknown');
      });
      expect(knownTypesForExtension('png')).toEqual([]);
      expect(knownTypesForExtension('png')).toEqual([]);
    });
  });
});
