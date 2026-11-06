import {saveDocuments} from '@react-native-documents/picker';
import {exportMobileLogs} from '@/services/log-export';
import {fs as mockFs, MOCK_DIRS} from '../test-utils/react-native-blob-util-mock';

const LOG_DIR = `${MOCK_DIRS.DocumentDir}/logs`;

interface FakeFile {
  readonly name: string;
  readonly text: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

/** 按 fake 文件表配置 ls / readFile / stat，返回按文件名取内容的辅助函数。 */
function stubLogFiles(files: readonly FakeFile[]): void {
  const byPath = new Map(files.map(file => [`${LOG_DIR}/${file.name}`, file]));
  (mockFs.ls as jest.Mock).mockResolvedValue(files.map(file => file.name));
  (mockFs.readFile as jest.Mock).mockImplementation((path: string) => Promise.resolve(byPath.get(path)?.text ?? null));
  (mockFs.stat as jest.Mock).mockImplementation((path: string) => {
    const file = byPath.get(path);
    return Promise.resolve(file == null ? null : {size: file.bytes, lastModified: file.mtimeMs});
  });
}

describe('exportMobileLogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockFs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (mockFs.unlink as jest.Mock).mockResolvedValue(undefined);
    (saveDocuments as jest.Mock).mockResolvedValue([{error: null}]);
  });

  it('把全部日志合并成一个 .txt，每份带文件名与字节数分隔头', async () => {
    stubLogFiles([
      {name: 'nm-20261103.log', text: 'day-3\n', bytes: 6, mtimeMs: 3},
      {name: 'nm-20261104.log', text: 'day-4\n', bytes: 6, mtimeMs: 4},
      {name: 'nm-20261105.log', text: 'day-5\n', bytes: 6, mtimeMs: 5},
      {name: 'nm-20261106.log', text: 'day-6\n', bytes: 6, mtimeMs: 6},
      {name: 'nm-20261107.log', text: 'day-7\n', bytes: 6, mtimeMs: 7},
    ]);

    await expect(exportMobileLogs()).resolves.toBe('saved');

    const [tmpPath, body] = (mockFs.writeFile as jest.Mock).mock.calls[0];
    expect(tmpPath).toMatch(/^\/cache\/nm-logs-\d{8}-\d{6}\.txt$/);
    const text = String(body);
    expect(text).toContain('===== nm-20261103.log (6) =====\nday-3\n');
    expect(text).toContain('===== nm-20261107.log (6) =====\nday-7\n');
    expect(text.indexOf('nm-20261103.log')).toBeLessThan(text.indexOf('nm-20261107.log'));
    expect(text).not.toContain('[truncated');
  });

  it('总量超过 8MB 时从最旧的文件开始丢弃并在头部注明', async () => {
    stubLogFiles([
      {name: 'nm-20261105.log', text: 'old-huge', bytes: 9 * 1024 * 1024, mtimeMs: 5},
      {name: 'nm-20261106.log', text: 'new-small', bytes: 9, mtimeMs: 6},
    ]);

    await expect(exportMobileLogs()).resolves.toBe('saved');

    const text = String((mockFs.writeFile as jest.Mock).mock.calls[0][1]);
    expect(text.startsWith('[truncated: dropped 1 file(s)]\n')).toBe(true);
    expect(text).not.toContain('old-huge');
    expect(text).toContain('===== nm-20261106.log (9) =====\nnew-small');
  });

  it('没有日志文件时导出一个空内容（仍走保存框）', async () => {
    stubLogFiles([]);

    await expect(exportMobileLogs()).resolves.toBe('saved');

    expect((mockFs.writeFile as jest.Mock).mock.calls[0][1]).toBe('');
  });
});
