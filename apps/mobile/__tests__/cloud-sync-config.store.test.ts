/**
 * tests/G-2：cloud-sync-config.store 真实单测（不 mock 被测模块）。
 *
 * 本实现 KKV 各字段以纯字符串存储（无 JSON 编码），「损坏 JSON 容错」体现为
 * 损坏的布尔/rev 字符串与缺失 key 的回退行为；与 cloud-sync.service 的非 mock
 * 集成用例见 cloud-sync-config.service.integration.test.ts。
 */
import {KkvError} from '@novel-master/core';
import type {KkvService} from '@novel-master/core';
import {
  CLOUD_SYNC_KKV_MODULE,
  CLOUD_SYNC_SECRET_REF,
  DEFAULT_CLOUD_SYNC_PATH_PREFIX,
  buildS3StorageConfig,
  generateCloudSyncDeviceId,
  getCloudSyncConfig,
  getCloudSyncLocalStatus,
  patchCloudSyncLocalStatus,
  readCloudSyncSecretKey,
  setCloudSyncConfig,
  type CloudSyncConfigInput,
} from '@/services/cloud-sync-config.store';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

class InMemoryKkv implements KkvService {
  private map = new Map<string, string>();

  private slot(module: string, key: string): string {
    return `${module}\u0000${key}`;
  }

  async listKeys(module: string): Promise<string[]> {
    return [...this.map.keys()]
      .filter(slot => slot.startsWith(`${module}\u0000`))
      .map(slot => slot.slice(module.length + 1));
  }

  async get(module: string, key: string): Promise<string> {
    const value = this.map.get(this.slot(module, key));
    if (value === undefined) {
      throw new KkvError('NOT_FOUND', `KKV key not found: ${module}/${key}`, {
        module,
        key,
      });
    }
    return value;
  }

  async set(module: string, key: string, value: string): Promise<void> {
    this.map.set(this.slot(module, key), value);
  }

  async delete(module: string, key: string): Promise<void> {
    if (!this.map.delete(this.slot(module, key))) {
      throw new KkvError('NOT_FOUND', `KKV key not found: ${module}/${key}`, {
        module,
        key,
      });
    }
  }

  /** 直接注入原始字符串（构造损坏/部分缺失状态）。 */
  inject(module: string, key: string, value: string): void {
    this.map.set(this.slot(module, key), value);
  }

  raw(module: string, key: string): string | undefined {
    return this.map.get(this.slot(module, key));
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
  return {runtime, kkv, secretStore};
}

function validInput(): CloudSyncConfigInput {
  return {
    endpoint: ' https://s3.example.com ',
    bucket: ' my-bucket ',
    region: ' us-east-1 ',
    pathPrefix: 'backup',
    accessKeyId: ' AKID ',
    secretAccessKey: ' SK-plain ',
    forcePathStyle: true,
    deviceLabel: ' Pixel ',
  };
}

describe('cloud-sync-config.store 默认配置装载', () => {
  it('空 KKV 时 getCloudSyncConfig 返回默认值', async () => {
    const {runtime} = makeRuntime();
    const config = await getCloudSyncConfig(runtime);
    expect(config).toEqual({
      endpoint: '',
      bucket: '',
      region: '',
      pathPrefix: DEFAULT_CLOUD_SYNC_PATH_PREFIX,
      accessKeyId: '',
      forcePathStyle: false,
      deviceId: '',
      deviceLabel: undefined,
      secretKeySet: false,
    });
  });

  it('空 KKV 时 getCloudSyncLocalStatus 未配置且 rev 归零', async () => {
    const {runtime} = makeRuntime();
    const status = await getCloudSyncLocalStatus(runtime);
    expect(status.configured).toBe(false);
    expect(status.deviceId).toBe('');
    expect(status.lastSyncedRev).toBe(0);
    expect(status.lastPullAt).toBeUndefined();
    expect(status.lastPushAt).toBeUndefined();
  });
});

describe('cloud-sync-config.store KKV 持久化往返', () => {
  it('setCloudSyncConfig 写入后读回：trim、前缀归一化、SK 只进 secretStore', async () => {
    const {runtime, kkv, secretStore} = makeRuntime();
    const config = await setCloudSyncConfig(runtime, validInput());

    expect(config).toEqual({
      endpoint: 'https://s3.example.com',
      bucket: 'my-bucket',
      region: 'us-east-1',
      pathPrefix: 'backup/',
      accessKeyId: 'AKID',
      forcePathStyle: true,
      deviceId: config.deviceId,
      deviceLabel: 'Pixel',
      secretKeySet: true,
    });
    expect(config.deviceId).not.toBe('');

    // SK 明文不落 KKV，只写 SKSP
    expect(await secretStore.get(CLOUD_SYNC_SECRET_REF)).toBe('SK-plain');
    for (const key of await kkv.listKeys(CLOUD_SYNC_KKV_MODULE)) {
      expect(await kkv.get(CLOUD_SYNC_KKV_MODULE, key)).not.toContain('SK-plain');
    }

    // 再次读回与首次返回一致，且 deviceId 稳定
    const again = await getCloudSyncConfig(runtime);
    expect(again).toEqual(config);
  });

  it('pathPrefix 为空回退默认前缀；已有 deviceId 复用不重新生成', async () => {
    const {runtime, kkv} = makeRuntime();
    kkv.inject(CLOUD_SYNC_KKV_MODULE, 'deviceId', 'dev-fixed');

    const config = await setCloudSyncConfig(runtime, {
      ...validInput(),
      pathPrefix: '   ',
    });
    expect(config.pathPrefix).toBe(DEFAULT_CLOUD_SYNC_PATH_PREFIX);
    expect(config.deviceId).toBe('dev-fixed');
  });

  it('patchCloudSyncLocalStatus 写入后 getCloudSyncLocalStatus 读回', async () => {
    const {runtime} = makeRuntime();
    await patchCloudSyncLocalStatus(runtime, {
      lastSyncedRev: 7,
      lastPullAt: '2026-08-30T01:00:00Z',
      lastPullResult: 'success',
    });
    const status = await getCloudSyncLocalStatus(runtime);
    expect(status.lastSyncedRev).toBe(7);
    expect(status.lastPullAt).toBe('2026-08-30T01:00:00Z');
    expect(status.lastPullResult).toBe('success');
    expect(status.lastPushAt).toBeUndefined();
  });

  it('配置完整时 configured 为 true', async () => {
    const {runtime} = makeRuntime();
    await setCloudSyncConfig(runtime, validInput());
    const status = await getCloudSyncLocalStatus(runtime);
    expect(status.configured).toBe(true);
    expect(status.deviceId).not.toBe('');
  });
});

describe('cloud-sync-config.store 容错', () => {
  it('损坏的 forcePathStyle / lastSyncedRev 字符串回退安全值', async () => {
    const {runtime, kkv} = makeRuntime();
    kkv.inject(CLOUD_SYNC_KKV_MODULE, 'forcePathStyle', 'garbage');
    kkv.inject(CLOUD_SYNC_KKV_MODULE, 'lastSyncedRev', 'not-a-number');

    const config = await getCloudSyncConfig(runtime);
    expect(config.forcePathStyle).toBe(false);
    const status = await getCloudSyncLocalStatus(runtime);
    expect(status.lastSyncedRev).toBe(0);
  });

  it('forcePathStyle 接受 true/1；rev 解析取整数部分、负数归零', async () => {
    const {runtime, kkv} = makeRuntime();
    kkv.inject(CLOUD_SYNC_KKV_MODULE, 'forcePathStyle', '1');
    kkv.inject(CLOUD_SYNC_KKV_MODULE, 'lastSyncedRev', '42abc');

    expect((await getCloudSyncConfig(runtime)).forcePathStyle).toBe(true);
    expect((await getCloudSyncLocalStatus(runtime)).lastSyncedRev).toBe(42);

    kkv.inject(CLOUD_SYNC_KKV_MODULE, 'lastSyncedRev', '-5');
    expect((await getCloudSyncLocalStatus(runtime)).lastSyncedRev).toBe(0);
  });

  it('字段部分缺失时逐字段回退，configured 仍为 false', async () => {
    const {runtime, kkv} = makeRuntime();
    // 只有 endpoint，缺 bucket / accessKeyId / SK / deviceId
    kkv.inject(CLOUD_SYNC_KKV_MODULE, 'endpoint', 'https://s3.example.com');

    const config = await getCloudSyncConfig(runtime);
    expect(config.endpoint).toBe('https://s3.example.com');
    expect(config.bucket).toBe('');
    expect(config.pathPrefix).toBe(DEFAULT_CLOUD_SYNC_PATH_PREFIX);

    const status = await getCloudSyncLocalStatus(runtime);
    expect(status.configured).toBe(false);
  });

  it('KKV 非 NOT_FOUND 错误原样抛出', async () => {
    const failing = {
      get: () => Promise.reject(new KkvError('IO', 'disk on fire')),
    } as never;
    const broken = {
      kkv: failing,
      secretStore: new InMemorySecretStore(),
    } as unknown as MobileNovelMasterRuntime;
    await expect(getCloudSyncConfig(broken)).rejects.toMatchObject({
      name: 'KkvError',
      code: 'IO',
    });
  });

  it('校验失败时不落任何 KKV / SKSP 写入', async () => {
    const {runtime, kkv, secretStore} = makeRuntime();
    for (const patch of [
      {endpoint: ' '},
      {bucket: ' '},
      {accessKeyId: ' '},
      {secretAccessKey: ' '},
    ]) {
      await expect(
        setCloudSyncConfig(runtime, {...validInput(), ...patch}),
      ).rejects.toThrow(/请填写/);
    }
    expect(await kkv.listKeys(CLOUD_SYNC_KKV_MODULE)).toEqual([]);
    expect(await secretStore.has(CLOUD_SYNC_SECRET_REF)).toBe(false);
  });

  it('deviceLabel 空白时不写 label key', async () => {
    const {runtime, kkv} = makeRuntime();
    await setCloudSyncConfig(runtime, {...validInput(), deviceLabel: '   '});
    expect(kkv.raw(CLOUD_SYNC_KKV_MODULE, 'deviceLabel')).toBeUndefined();
  });
});

describe('cloud-sync-config.store buildS3StorageConfig / readCloudSyncSecretKey', () => {
  it('未配置完整时抛错', async () => {
    const {runtime} = makeRuntime();
    await expect(buildS3StorageConfig(runtime)).rejects.toThrow(
      '请先完成云存储配置',
    );
  });

  it('已存配置组装 S3StorageConfig，SK 从 SKSP 读取', async () => {
    const {runtime} = makeRuntime();
    await setCloudSyncConfig(runtime, validInput());
    const s3 = await buildS3StorageConfig(runtime);
    expect(s3).toEqual({
      endpoint: 'https://s3.example.com',
      bucket: 'my-bucket',
      region: 'us-east-1',
      accessKeyId: 'AKID',
      secretAccessKey: 'SK-plain',
      forcePathStyle: true,
    });
  });

  it('overrides 优先于已存配置（可临时换 SK 测试连接）', async () => {
    const {runtime} = makeRuntime();
    await setCloudSyncConfig(runtime, validInput());
    const s3 = await buildS3StorageConfig(runtime, {
      endpoint: 'https://other.example.com',
      secretAccessKey: 'SK-tmp',
      forcePathStyle: false,
    });
    expect(s3.endpoint).toBe('https://other.example.com');
    expect(s3.secretAccessKey).toBe('SK-tmp');
    expect(s3.forcePathStyle).toBe(false);
    expect(s3.bucket).toBe('my-bucket');
  });

  it('readCloudSyncSecretKey 未设置时返回 null', async () => {
    const {runtime} = makeRuntime();
    expect(await readCloudSyncSecretKey(runtime.secretStore)).toBeNull();
  });

  it('generateCloudSyncDeviceId 生成 UUID v4 形状', () => {
    expect(generateCloudSyncDeviceId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
