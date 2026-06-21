import {
  createCloudSyncProgress,
  shortStorageKey,
  withCloudSyncStorageProgress,
} from '../src/services/cloud-sync-progress-log';
import {
  initialCloudSyncProgressUi,
  mapCloudSyncProgressEvent,
} from '../src/services/cloud-sync-progress-ui';

describe('cloud-sync-progress-log', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  afterEach(() => {
    warnSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('shortStorageKey 缩写长路径', () => {
    expect(shortStorageKey('sync/status.json')).toBe('sync/status.json');
    expect(shortStorageKey('sync/snapshots/rev-3.nmbackup')).toBe(
      '…/snapshots/rev-3.nmbackup',
    );
  });

  it('withCloudSyncStorageProgress 记录 put 字节数', async () => {
    const progress = createCloudSyncProgress('push');
    const storage = withCloudSyncStorageProgress(
      {
        head: async () => ({exists: false}),
        get: async () => ({body: new Uint8Array(), etag: 'e'}),
        put: async () => ({etag: '"abc123"'}),
      },
      progress,
    );

    await storage.put('sync/status.json', new Uint8Array([1, 2, 3]));

    const putStart = warnSpy.mock.calls.find(
      call => call[1] === 'storage_put_start',
    );
    expect(putStart?.[2]).toMatchObject({op: 'push', bytes: 3});
  });

  it('createCloudSyncProgress 向 UI 回调推送阶段', () => {
    const uiUpdates: string[] = [];
    const progress = createCloudSyncProgress('push', {
      onUiProgress: state => uiUpdates.push(state.label),
    });

    progress.step('db_export_start');
    progress.step('storage_put_file_start', {fromPath: true});
    progress.done({rev: 1});

    expect(uiUpdates).toEqual([
      '导出本地数据库…',
      '上传快照到云端…',
      '推送完成',
    ]);
  });
});

describe('cloud-sync-progress-ui', () => {
  it('initialCloudSyncProgressUi 返回起始状态', () => {
    expect(initialCloudSyncProgressUi('push').label).toBe('准备推送…');
  });

  it('mapCloudSyncProgressEvent 区分快照上传', () => {
    const mapped = mapCloudSyncProgressEvent('push', 'storage_put_file_start', {
      fromPath: true,
    });
    expect(mapped).toMatchObject({
      label: '上传快照到云端…',
      indeterminate: true,
      progress: 0.42,
    });
  });
});
