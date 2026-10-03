/**
 * vfs-single-file.service 单测（模板照 vfs-zip.service.test.ts）。
 *
 * 覆盖：picker → planBatchIngest 单条目 → 冲突确认（不 apply）→ 确认后 apply、
 * 取消静默、二进制跳过信息回传、单文件导出（fileName/MIME 兜底/utf8 写盘）、
 * session scope 透传到 core。
 */
const mockCreateVfsBatchIoService = jest.fn();
const mockPlanBatchIngest = jest.fn();
const mockApplyBatchIngest = jest.fn();
const mockPlanBatchExport = jest.fn();
const mockPick = jest.fn();
const mockKeepLocalCopy = jest.fn();
const mockSaveDocuments = jest.fn();
const mockWriteFile = jest.fn();
const mockReadFile = jest.fn();
const mockExists = jest.fn();
const mockStat = jest.fn();
const mockUnlink = jest.fn();

jest.mock('@novel-master/core/vfs', () => ({
  ...jest.requireActual('@novel-master/core/vfs'),
  createVfsBatchIoService: (...args: unknown[]) =>
    mockCreateVfsBatchIoService(...args),
}));

jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  keepLocalCopy: (...args: unknown[]) => mockKeepLocalCopy(...args),
  saveDocuments: (...args: unknown[]) => mockSaveDocuments(...args),
  // 测试环境恒不识别扩展名 → knownTypesForExtension 恒 []（正是兜底要覆盖的形态）
  isKnownType: () => undefined,
  types: {
    json: 'application/json',
    plainText: 'text/plain',
  },
  errorCodes: {OPERATION_CANCELED: 'OPERATION_CANCELED'},
  isErrorWithCode: (err: unknown) =>
    typeof err === 'object' &&
    err != null &&
    'code' in err &&
    (err as {code: string}).code === 'OPERATION_CANCELED',
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

import {
  exportVfsSingleFile,
  importVfsSingleFile,
} from '@/services/vfs-single-file.service';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {VfsSingleFileError} from '@/errors/vfs-single-file-error';

/** 选中文件在 blob 层的 base64 载荷（btoa 只吃 Latin-1，用 ASCII 内容）。 */
const FILE_BYTES_BASE64 = globalThis.btoa('hi');
const FILE_BYTES = new Uint8Array([0x68, 0x69]);

describe('vfs-single-file.service', () => {
  const runtime = {conn: {}} as unknown as MobileNovelMasterRuntime;
  const scope = {kind: 'session', projectId: 'p', sessionId: 's'} as const;

  /** 无冲突的 plan 默认值。 */
  function plan(overrides: Record<string, unknown> = {}) {
    return {
      writes: [{relativePath: '资料.md', content: '正文内容'}],
      mkdirPaths: [],
      conflicts: [],
      skippedBinary: [],
      typeConflicts: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    mockCreateVfsBatchIoService.mockReset();
    mockPlanBatchIngest.mockReset();
    mockApplyBatchIngest.mockReset();
    mockPlanBatchExport.mockReset();
    mockPick.mockReset();
    mockKeepLocalCopy.mockReset();
    mockSaveDocuments.mockReset();
    mockWriteFile.mockReset();
    mockReadFile.mockReset();
    mockExists.mockReset();
    mockStat.mockReset();
    mockUnlink.mockReset();

    mockCreateVfsBatchIoService.mockReturnValue({
      planBatchIngest: mockPlanBatchIngest,
      applyBatchIngest: mockApplyBatchIngest,
      planBatchExport: mockPlanBatchExport,
    });
    mockPick.mockResolvedValue([
      {uri: 'content://downloads/资料.md', name: '资料.md'},
    ]);
    mockKeepLocalCopy.mockResolvedValue([
      {
        status: 'success',
        localUri: 'file:///cache/import.bin',
        sourceUri: 'content://downloads/资料.md',
      },
    ]);
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(FILE_BYTES_BASE64);
    mockStat.mockResolvedValue({path: '/cache/import.bin', size: 12});
    mockPlanBatchIngest.mockResolvedValue(plan());
    mockApplyBatchIngest.mockResolvedValue({
      written: ['/角色/资料.md'],
      skipped: [],
      failed: [],
    });
    mockWriteFile.mockResolvedValue(undefined);
    mockSaveDocuments.mockResolvedValue([
      {uri: 'content://saved', name: '资料.md', error: null},
    ]);
    mockUnlink.mockResolvedValue(undefined);
  });

  // T-MF1
  it('导入：plan 单条目（relativePath=fileName，targetDir 透传），冲突先返回确认请求', async () => {
    mockPlanBatchIngest.mockResolvedValue(
      plan({conflicts: [{logicalPath: '/角色/资料.md', reason: 'exists'}]}),
    );

    const result = await importVfsSingleFile(runtime, scope, {
      targetDir: '/角色',
    });

    expect(mockCreateVfsBatchIoService).toHaveBeenCalledWith(runtime.conn);
    expect(mockPlanBatchIngest).toHaveBeenCalledWith(
      scope,
      '/角色',
      [
        {
          relativePath: '资料.md',
          kind: 'file',
          bytes: FILE_BYTES,
        },
      ],
    );
    // 冲突未确认前绝不落库
    expect(mockApplyBatchIngest).not.toHaveBeenCalled();
    expect(result.status).toBe('needs-confirm');
    if (result.status !== 'needs-confirm') {
      throw new Error('expected needs-confirm');
    }
    expect(result.conflictCount).toBe(1);
    expect(result.fileName).toBe('资料.md');

    // 确认后复用同一份 plan 落库（overwriteConfirmed: true）
    const applied = await result.confirm();
    expect(mockApplyBatchIngest).toHaveBeenCalledWith(
      scope,
      '/角色',
      expect.objectContaining({writes: [{relativePath: '资料.md', content: '正文内容'}]}),
      {overwriteConfirmed: true},
    );
    expect(applied.status).toBe('applied');
    expect(applied.status === 'applied' && applied.report.written).toEqual([
      '/角色/资料.md',
    ]);
  });

  it('导入：无冲突时直接 apply（overwriteConfirmed: true）', async () => {
    const result = await importVfsSingleFile(runtime, scope);

    expect(mockPlanBatchIngest).toHaveBeenCalledWith(
      scope,
      '/',
      [expect.objectContaining({relativePath: '资料.md'})],
    );
    expect(mockApplyBatchIngest).toHaveBeenCalledWith(
      scope,
      '/',
      expect.anything(),
      {overwriteConfirmed: true},
    );
    expect(result).toMatchObject({status: 'applied', skippedBinary: []});
  });

  // T-MF2
  it('picker 取消静默返回 cancelled 且不触达 core', async () => {
    mockPick.mockResolvedValue([]);

    const result = await importVfsSingleFile(runtime, scope);

    expect(result).toEqual({status: 'cancelled'});
    expect(mockKeepLocalCopy).not.toHaveBeenCalled();
    expect(mockCreateVfsBatchIoService).not.toHaveBeenCalled();
    expect(mockPlanBatchIngest).not.toHaveBeenCalled();
    expect(mockApplyBatchIngest).not.toHaveBeenCalled();
  });

  // 超限链（CR G-2）：stat 造 32MB+ 文件 → buildTooLargeError 抛 VfsSingleFileError
  // → 不读字节、不触达 core。
  it('超限：stat 32MB+ 文件直接抛 VfsSingleFileError，不读字节不触达 core', async () => {
    const oversize = 33 * 1024 * 1024;
    mockStat.mockResolvedValue({path: '/cache/import.bin', size: oversize});

    const error = await importVfsSingleFile(runtime, scope).then(
      () => undefined,
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(VfsSingleFileError);
    expect((error as VfsSingleFileError).name).toBe('VfsSingleFileError');
    const message = (error as Error).message;
    expect(message).toContain(`${oversize} 字节`);
    expect(message).toContain(`超过导入上限 ${32 * 1024 * 1024} 字节`);
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockPlanBatchIngest).not.toHaveBeenCalled();
    expect(mockApplyBatchIngest).not.toHaveBeenCalled();
  });

  // T-MF3
  it('非 UTF-8 文件被 core 判跳过：结果带回 skippedBinary 供 UI 明示', async () => {
    mockPlanBatchIngest.mockResolvedValue(
      plan({writes: [], skippedBinary: ['a.png']}),
    );
    mockApplyBatchIngest.mockResolvedValue({
      written: [],
      skipped: ['a.png'],
      failed: [],
    });

    const result = await importVfsSingleFile(runtime, scope);

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') {
      throw new Error('expected applied');
    }
    expect(result.skippedBinary).toEqual(['a.png']);
    expect(result.report.written).toEqual([]);
  });

  // T-MF4
  it('导出：planBatchExport 单元素 → fileName=basename、MIME 兜底 text/plain、utf8 写盘', async () => {
    mockPlanBatchExport.mockResolvedValue({
      files: [{relativePath: '资料.md', content: '正文内容'}],
      mkdirPaths: [],
      skipped: [],
    });

    const result = await exportVfsSingleFile(runtime, scope, '/角色/资料.md');

    expect(mockPlanBatchExport).toHaveBeenCalledWith(scope, ['/角色/资料.md']);
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/cache/资料.md',
      '正文内容',
      'utf8',
    );
    expect(mockSaveDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUris: ['file:///cache/资料.md'],
        fileName: '资料.md',
        mimeType: 'text/plain',
      }),
    );
    expect(mockUnlink).toHaveBeenCalledWith('/cache/资料.md');
    expect(result).toBe('saved');
  });

  it('导出：files 不等于 1（误传目录）报错且不写盘', async () => {
    mockPlanBatchExport.mockResolvedValue({
      files: [
        {relativePath: 'a.md', content: 'a'},
        {relativePath: 'b.md', content: 'b'},
      ],
      mkdirPaths: [],
      skipped: [],
    });

    const failure = await exportVfsSingleFile(runtime, scope, '/角色').then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(VfsSingleFileError);
    expect((failure as Error).message).toContain('/角色');
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockSaveDocuments).not.toHaveBeenCalled();
  });

  it('导出：用户取消保存返回 cancelled', async () => {
    mockPlanBatchExport.mockResolvedValue({
      files: [{relativePath: '资料.md', content: '正文内容'}],
      mkdirPaths: [],
      skipped: [],
    });
    mockSaveDocuments.mockRejectedValue({code: 'OPERATION_CANCELED'});

    await expect(
      exportVfsSingleFile(runtime, scope, '/角色/资料.md'),
    ).resolves.toBe('cancelled');
  });

  // T-MF5
  it('session scope 透传到 core（缓存清理由 core 负责，本层只保证 scope 不丢）', async () => {
    await importVfsSingleFile(runtime, scope, {targetDir: '/角色'});

    expect(mockPlanBatchIngest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({kind: 'session', sessionId: 's'}),
    );
    expect(mockApplyBatchIngest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({kind: 'session', sessionId: 's'}),
    );
  });
});
