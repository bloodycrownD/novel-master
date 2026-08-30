/**
 * tests/G-2 集成用例：cloud-sync.service × cloud-sync-config.store 均不 mock。
 *
 * 选取不触网的 service 路径（未配置 / 配置不完整的短路分支），
 * 验证 service 真实消费 store 从 KKV + SKSP 装载的状态。
 */
import {KkvError} from '@novel-master/core';
import {
  getCloudSyncStatusView,
  pullCloudSync,
  pushCloudSync,
  setCloudSyncConfig,
} from '@/services/cloud-sync.service';
import {CLOUD_SYNC_SECRET_REF} from '@/services/cloud-sync-config.store';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

// 外部 IO 边界：S3 请求立即拒绝，保证「不触网」且不遗留挂起句柄
// （store 与 service 本体均不 mock）。
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = () => Promise.reject(new Error('no network in tests'));
  },
  HeadBucketCommand: class {},
  ListObjectsV2Command: class {},
}));

class InMemoryKkv {
  private map = new Map<string, string>();
  async get(module: string, key: string): Promise<string> {
    const value = this.map.get(`${module}/${key}`);
    if (value === undefined) {
      throw new KkvError('NOT_FOUND', 'missing');
    }
    return value;
  }
  async set(module: string, key: string, value: string): Promise<void> {
    this.map.set(`${module}/${key}`, value);
  }
  async delete(module: string, key: string): Promise<void> {
    this.map.delete(`${module}/${key}`);
  }
}

class InMemorySecretStore {
  private map = new Map<string, string>();
  async has(ref: string): Promise<boolean> {
    return this.map.has(ref);
  }
  async get(ref: string): Promise<string | null> {
    return this.map.get(ref) ?? null;
  }
  async set(ref: string, value: string): Promise<void> {
    this.map.set(ref, value);
  }
  async delete(ref: string): Promise<void> {
    this.map.delete(ref);
  }
}

function makeRuntime() {
  const kkv = new InMemoryKkv();
  const secretStore = new InMemorySecretStore();
  const runtime = {kkv, secretStore} as unknown as MobileNovelMasterRuntime;
  return {runtime, secretStore};
}

describe('cloud-sync.service × cloud-sync-config.store 集成', () => {
  it('未配置时 getCloudSyncStatusView 短路返回且不触网', async () => {
    const {runtime} = makeRuntime();
    const view = await getCloudSyncStatusView(runtime);
    expect(view.configured).toBe(false);
    expect(view.remoteRev).toBe(0);
    expect(view.suggestPull).toBe(false);
    expect(view.lastSyncedRev).toBe(0);
  });

  it('未配置时 pullCloudSync / pushCloudSync 抛 NOT_CONFIGURED', async () => {
    const {runtime} = makeRuntime();
    await expect(pullCloudSync(runtime, () => undefined)).rejects.toMatchObject(
      {
        name: 'CloudSyncError',
        code: 'NOT_CONFIGURED',
      },
    );
    await expect(pushCloudSync(runtime, undefined)).rejects.toMatchObject({
      name: 'CloudSyncError',
      code: 'NOT_CONFIGURED',
    });
  });

  it('service 真实消费 store 写入的配置：SK 缺失即视为未配置', async () => {
    const {runtime, secretStore} = makeRuntime();
    await setCloudSyncConfig(runtime, {
      endpoint: 'https://s3.example.com',
      bucket: 'my-bucket',
      region: '',
      pathPrefix: '',
      accessKeyId: 'AKID',
      secretAccessKey: 'SK-plain',
      forcePathStyle: false,
    });
    // 配置完整 → configured；远端 rev 读取因 S3 拒绝而回退 0（service 的 catch 兕底）
    const configuredView = await getCloudSyncStatusView(runtime);
    expect(configuredView.configured).toBe(true);
    expect(configuredView.remoteRev).toBe(0);

    // SK 被清除后（如用户手动清库），store 装载的 configured 回落 false，
    // service 走未配置短路而不触网
    await secretStore.delete(CLOUD_SYNC_SECRET_REF);
    const view = await getCloudSyncStatusView(runtime);
    expect(view.configured).toBe(false);
    expect(view.remoteRev).toBe(0);
  });
});
