import {addLogSink, createLogger, restoreDefaultLogSink, setDefaultLogSink} from '@novel-master/core/log';
import type {LogRecord} from '@novel-master/core/log';
import {installJsCrashHandler, installMobileLogSink} from '@/services/log-sink.mobile';
import {fs as mockFs, MOCK_DIRS} from '../test-utils/react-native-blob-util-mock';

const LOG_DIR = `${MOCK_DIRS.DocumentDir}/logs`;

function todayKey(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/** 写入走 promise 链，等一个宏任务把整条链排空。 */
function flushWrites(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('installMobileLogSink', () => {
  let remove: (() => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    setDefaultLogSink(null);
    (mockFs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (mockFs.ls as jest.Mock).mockResolvedValue([]);
    (mockFs.stat as jest.Mock).mockResolvedValue({size: 0, lastModified: 0});
    (mockFs.appendFile as jest.Mock).mockResolvedValue(0);
    (mockFs.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    remove?.();
    remove = null;
    restoreDefaultLogSink();
  });

  it('把 logger 记录追加到 DocumentDir/logs/nm-<日期>.log', async () => {
    remove = await installMobileLogSink();

    createLogger('test.scope').info('hello', {tokenCount: 3});
    await flushWrites();

    expect(mockFs.appendFile).toHaveBeenCalledTimes(1);
    const [path, line, encoding] = (mockFs.appendFile as jest.Mock).mock.calls[0];
    expect(path).toBe(`${LOG_DIR}/nm-${todayKey()}.log`);
    expect(encoding).toBe('utf8');
    const fields = String(line).split('\t');
    expect(fields[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(fields.slice(1, 4)).toEqual(['info', 'test.scope', 'hello']);
    expect(fields[4]).toBe('{"tokenCount":3}\n');
  });

  it('当日文件已写满 2MB 时切到 .1 段', async () => {
    const base = `nm-${todayKey()}.log`;
    (mockFs.ls as jest.Mock).mockResolvedValue([base]);
    (mockFs.stat as jest.Mock).mockResolvedValue({size: 2 * 1024 * 1024, lastModified: 1});
    remove = await installMobileLogSink();

    createLogger('test.scope').warn('rollover');
    await flushWrites();

    expect((mockFs.appendFile as jest.Mock).mock.calls[0][0]).toBe(`${LOG_DIR}/nm-${todayKey()}.1.log`);
  });

  it('保留最新 5 份：按 mtime 删掉最旧的一份', async () => {
    const names = ['nm-20200101.log', 'nm-20200102.log', 'nm-20200103.log', 'nm-20200104.log', 'nm-20200105.log', 'nm-20200106.log'];
    const mtimes = new Map(names.map((name, index) => [`${LOG_DIR}/${name}`, 1_000 + index]));
    (mockFs.ls as jest.Mock).mockResolvedValue(names);
    (mockFs.stat as jest.Mock).mockImplementation((path: string) => Promise.resolve({size: 10, lastModified: mtimes.get(path) ?? 0}));
    remove = await installMobileLogSink();

    createLogger('test.scope').info('prune');
    await flushWrites();

    expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    expect((mockFs.unlink as jest.Mock).mock.calls[0][0]).toBe(`${LOG_DIR}/nm-20200101.log`);
  });
});

describe('installJsCrashHandler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    restoreDefaultLogSink();
  });

  it('新处理器先记 crash 日志、再链式调用旧处理器', () => {
    const records: LogRecord[] = [];
    const remove = addLogSink({write: record => records.push(record)});
    const previous = jest.fn();
    jest.spyOn(ErrorUtils, 'getGlobalHandler').mockReturnValue(previous);
    const setGlobalHandler = jest.spyOn(ErrorUtils, 'setGlobalHandler').mockImplementation(() => undefined);

    installJsCrashHandler();

    expect(setGlobalHandler).toHaveBeenCalledTimes(1);
    const error = new Error('fatal-boom');
    setGlobalHandler.mock.calls[0][0](error, true);

    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(error, true);
    const crash = records.find(record => record.scope === 'crash');
    expect(crash?.level).toBe('error');
    expect(crash?.message).toBe('uncaught_js_error');
    expect(crash?.detail).toMatchObject({error: {name: 'Error', message: 'fatal-boom'}, isFatal: true});
    remove();
  });
});
