import {Result} from '@novel-master/core/errors';
import {CloudSyncProgressLog} from '@/services/cloud-sync-progress-log';
import {CloudSyncProgressUi} from '@/services/cloud-sync-progress-ui'

describe('cloud-sync-progress-log', () => {
  const warnSpy = jest
    .spyOn(console, 'warn')
    .mockImplementation(() => undefined);

  afterEach(() => {
    warnSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('shortStorageKey 缩写长路径', () => {
    expect(CloudSyncProgressLog.shortStorageKey('sync/status.json')).toBe('sync/status.json');
    expect(CloudSyncProgressLog.shortStorageKey('sync/snapshots/rev-3.nmbackup')).toBe(
      '…/snapshots/rev-3.nmbackup',
    );
  });

  it('withCloudSyncStorageProgress 记录 put 字节数', async () => {
    const progress = CloudSyncProgressLog.create('push');
    const storage = CloudSyncProgressLog.withStorageProgress(
      {
        head: async () => ({exists: false}),
        get: async () => ({body: new Uint8Array(), etag: 'e'}),
        // put/putFile/getToPath 已知失败走 Result.err（错误通道迁移六期）。
        put: async () => Result.ok({etag: '"abc123"'}),
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
    const progress = CloudSyncProgressLog.create('push', {
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
    expect(CloudSyncProgressUi.initial('push').label).toBe('准备推送…');
  });

  it('mapCloudSyncProgressEvent 区分快照上传', () => {
    const mapped = CloudSyncProgressUi.mapEvent('push', 'storage_put_file_start', {
      fromPath: true,
    });
    expect(mapped).toMatchObject({
      label: '上传快照到云端…',
      indeterminate: true,
      progress: 0.42,
    });
  });
});
