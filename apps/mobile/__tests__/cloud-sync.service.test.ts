import {CloudSyncError} from '@novel-master/core';
import {
  pullCloudSync,
  pushCloudSync,
  sha256Hex,
  testCloudSyncConnection,
} from '@/services/cloud-sync.service';
import {
  isMobileDbMaintenanceBusy,
  releaseMobileDbMaintenanceBusy,
} from '@/services/db-maintenance-busy';

const mockGetConfig = jest.fn();
const mockGetLocalStatus = jest.fn();
const mockPatchLocalStatus = jest.fn();
const mockBuildS3Config = jest.fn();
const mockCreateS3Storage = jest.fn();
const mockExportToPath = jest.fn();
const mockImportFromBytes = jest.fn();
const mockImportFromPath = jest.fn();
const mockAgentActive = jest.fn();
const mockCoordinatorPull = jest.fn();
const mockCoordinatorPush = jest.fn();
const mockHeadBucket = jest.fn();
const mockListObjects = jest.fn();
const mockUnlink = jest.fn();
const mockReadFile = jest.fn();
const mockStat = jest.fn();

jest.mock('@/services/cloud-sync-config.store', () => ({
  CLOUD_SYNC_KKV_MODULE: 'nm-cloud-sync',
  CLOUD_SYNC_SECRET_REF: 'cloud-sync/s3-secret-key',
  DEFAULT_CLOUD_SYNC_PATH_PREFIX: 'novel-master/sync/',
  getCloudSyncConfig: (...args: unknown[]) => mockGetConfig(...args),
  getCloudSyncLocalStatus: (...args: unknown[]) => mockGetLocalStatus(...args),
  patchCloudSyncLocalStatus: (...args: unknown[]) =>
    mockPatchLocalStatus(...args),
  buildS3StorageConfig: (...args: unknown[]) => mockBuildS3Config(...args),
  setCloudSyncConfig: jest.fn(),
  generateCloudSyncDeviceId: jest.fn(() => 'device-1'),
}));

jest.mock('@novel-master/cloud-sync-driver-s3', () => ({
  createS3ObjectStorage: (...args: unknown[]) => mockCreateS3Storage(...args),
}));

jest.mock('@novel-master/core', () => {
  const actual = jest.requireActual('@novel-master/core');
  return {
    ...actual,
    CloudSyncCoordinator: jest.fn().mockImplementation(() => ({
      pull: (...args: unknown[]) => mockCoordinatorPull(...args),
      push: (...args: unknown[]) => mockCoordinatorPush(...args),
    })),
  };
});

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: (command: {constructor: {name: string}}) => {
      if (command.constructor.name === 'HeadBucketCommand') {
        return mockHeadBucket();
      }
      if (command.constructor.name === 'ListObjectsV2Command') {
        return mockListObjects();
      }
      return Promise.resolve({});
    },
  })),
  HeadBucketCommand: class HeadBucketCommand {},
  ListObjectsV2Command: class ListObjectsV2Command {},
}));

jest.mock('@/services/db-backup.service', () => ({
  exportDatabaseBackupToPath: (...args: unknown[]) => mockExportToPath(...args),
  importDatabaseBackupFromBytes: (...args: unknown[]) =>
    mockImportFromBytes(...args),
  importDatabaseBackupFromPath: (...args: unknown[]) =>
    mockImportFromPath(...args),
  DatabaseReplacedError: class DatabaseReplacedError extends Error {
    // 刻意不用 TS 参数属性写法：jest.mock 的模块工厂不允许引用任何 out-of-scope
    // 变量，babel 的静态检查会把参数名当成自由变量而报错。
    databaseReplaced: boolean;
    providerTablesRestored: boolean;
    constructor(message: string, providerTablesRestored: boolean) {
      super(message);
      this.name = 'DatabaseReplacedError';
      this.databaseReplaced = true;
      this.providerTablesRestored = providerTablesRestored;
    }
  },
}));

jest.mock('@/runtime/agent-activity', () => ({
  isMobileAgentActive: () => mockAgentActive(),
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {CacheDir: '/cache'},
      unlink: (...args: unknown[]) => mockUnlink(...args),
      readFile: (...args: unknown[]) => mockReadFile(...args),
      stat: (...args: unknown[]) => mockStat(...args),
    },
  },
}));

const runtime = {
  kkv: {},
  secretStore: {
    get: jest.fn(),
    set: jest.fn(),
    has: jest.fn(),
    delete: jest.fn(),
  },
  conn: {},
} as never;

const storage = {
  head: jest.fn(),
  get: jest.fn(),
  put: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAgentActive.mockReturnValue(false);
  mockGetConfig.mockResolvedValue({
    endpoint: 'https://s3.example.com',
    bucket: 'test-bucket',
    region: '',
    pathPrefix: 'novel-master/sync/',
    accessKeyId: 'ak',
    forcePathStyle: true,
    deviceId: 'device-1',
    secretKeySet: true,
  });
  mockGetLocalStatus.mockResolvedValue({
    configured: true,
    deviceId: 'device-1',
    lastSyncedRev: 1,
  });
  mockBuildS3Config.mockResolvedValue({
    endpoint: 'https://s3.example.com',
    bucket: 'test-bucket',
    region: '',
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    forcePathStyle: true,
  });
  mockCreateS3Storage.mockReturnValue(storage);
  // clearAllMocks 只清调用记录、**不清实现**；pullCloudSync 里那条「拿旧 runtime
  // 记账就抛 CONNECTION_CLOSED」的探针必须在这里复位，否则会漏给后续用例。
  mockPatchLocalStatus.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue('AA==');
  mockStat.mockResolvedValue({size: 2});
  mockHeadBucket.mockResolvedValue({});
  mockListObjects.mockResolvedValue({Contents: []});
  storage.head.mockResolvedValue({exists: false});
});

describe('sha256Hex', () => {
  it('空输入返回已知哈希', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('testCloudSyncConnection', () => {
  it('HeadBucket 成功时不抛错', async () => {
    await expect(testCloudSyncConnection(runtime)).resolves.toBeUndefined();
    expect(mockHeadBucket).toHaveBeenCalled();
  });

  it('SDK 抛出 Deserialization error 时 reject 为用户向中文 message', async () => {
    const sdkError = new Error(
      'Deserialization error: Unable to parse response body',
    );
    mockHeadBucket.mockRejectedValue(sdkError);
    mockListObjects.mockRejectedValue(sdkError);

    await expect(testCloudSyncConnection(runtime)).rejects.toMatchObject({
      code: 'NETWORK',
      message: '云存储连接失败，请检查网络与配置',
    });
  });
});

describe('pullCloudSync', () => {
  // 「换成重建出来的新 runtime」的可观测替身：pull 换库后必须调它，
  // 且记账必须落在它返回的那个 runtime 上。
  const freshRuntime = {kkv: {id: 'fresh'}} as never;

  afterEach(() => {
    // 兜底清位：maintenanceBusyCount 是进程级模块变量，任何用例泄漏都会
    // 连带把同文件后续用例（乃至同进程其它套件）全判红。
    while (isMobileDbMaintenanceBusy()) {
      releaseMobileDbMaintenanceBusy();
    }
  });

  it('拉取换代成功时先 onRebootstrap 再用新 runtime 记账', async () => {
    mockCoordinatorPull.mockResolvedValue({rev: 3, databaseReplaced: true});
    const order: string[] = [];
    const rebootstrap = jest.fn(async () => {
      order.push('rebootstrap');
      return freshRuntime;
    });
    // 「旧 runtime 背后的连接已被换库关掉」的探针：拿它记账必抛
    // CONNECTION_CLOSED（这正是 S-CS-01 的 P0 正身）。写成实现而不是
    // 只比对实参身份，回退到旧 runtime 会直接让本条 reject，而不是假绿。
    mockPatchLocalStatus.mockImplementation((rt: unknown) => {
      if (rt === runtime) {
        return Promise.reject(new Error('CONNECTION_CLOSED'));
      }
      order.push('patch');
      return Promise.resolve();
    });

    const result = await pullCloudSync(runtime, rebootstrap);

    expect(result).toEqual({rev: 3, alreadyUpToDate: false});
    expect(mockCoordinatorPull).toHaveBeenCalledWith({lastSyncedRev: 1});
    expect(rebootstrap).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['rebootstrap', 'patch']);
    // 记账必须落在新 runtime 上。
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      freshRuntime,
      expect.objectContaining({
        lastSyncedRev: 3,
        lastPullResult: 'success',
      }),
    );
    expect(mockPatchLocalStatus).not.toHaveBeenCalledWith(
      runtime,
      expect.anything(),
    );
    expect(mockImportFromBytes).not.toHaveBeenCalled();
  });

  it('databaseReplaced=false 时不调用 onRebootstrap 且记账走旧 runtime', async () => {
    // S-CS-16：这条分支不换代（库没换、连接没关），所以记账可以用旧 runtime。
    mockCoordinatorPull.mockResolvedValue({rev: 3, databaseReplaced: false});
    const rebootstrap = jest.fn(async () => freshRuntime);

    const result = await pullCloudSync(runtime, rebootstrap);

    expect(result).toEqual({rev: 3, alreadyUpToDate: false});
    expect(rebootstrap).not.toHaveBeenCalled();
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPullResult: 'already_up_to_date'}),
    );
  });

  it('ALREADY_UP_TO_DATE 时不调用 onRebootstrap 且记账走旧 runtime', async () => {
    mockCoordinatorPull.mockRejectedValue(
      new CloudSyncError('ALREADY_UP_TO_DATE', '本地已是最新，无需拉取'),
    );
    const rebootstrap = jest.fn(async () => freshRuntime);

    const result = await pullCloudSync(runtime, rebootstrap);

    expect(result).toEqual({rev: 1, alreadyUpToDate: true});
    expect(rebootstrap).not.toHaveBeenCalled();
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPullResult: 'already_up_to_date'}),
    );
  });

  it('catch 分支在 pull 已换代时先重建再用新 runtime 记账', async () => {
    const {DatabaseReplacedError} = jest.requireMock<
      typeof import('@/services/db-backup.service')
    >('@/services/db-backup.service');
    mockCoordinatorPull.mockRejectedValue(
      new DatabaseReplacedError('数据库已导入，但本机服务商配置恢复失败', false),
    );
    const rebootstrap = jest.fn(async () => freshRuntime);

    await expect(pullCloudSync(runtime, rebootstrap)).rejects.toBeDefined();

    // mobile 的 runtime 是 React state、没有懒建自愈 ⇒ 不补这条，一次失败 pull
    // 之后整个 App 会带着已关 runtime 跑到用户手动重启。
    expect(rebootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      freshRuntime,
      expect.objectContaining({lastPullResult: 'error'}),
    );
  });

  it('未配置时抛 NOT_CONFIGURED', async () => {
    mockGetLocalStatus.mockResolvedValue({
      configured: false,
      deviceId: '',
      lastSyncedRev: 0,
    });

    await expect(
      pullCloudSync(runtime, jest.fn(async () => freshRuntime)),
    ).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('createCoordinator 抛错时 reject 且 isMobileDbMaintenanceBusy() 回到 false', async () => {
    // S-CS-04 主断言（必红→必绿）：acquire 令牌之后到 try 之间原本有一段
    // 可抛代码（createCoordinator），它一抛 finally 就不执行 ⇒
    // maintenanceBusyCount 永久 +1 ⇒ 消息解压 / blob 归一两个后台循环在本进程
    // 剩余生命周期内全部停摆，而用户侧零报错。
    // 反向断言：调用前先确认计数是干净的——否则本条的 `=== false` 会恒红，
    // 而上一条若把它配平了，本条的「泄漏」就观测不到。
    expect(isMobileDbMaintenanceBusy()).toBe(false);
    mockBuildS3Config.mockRejectedValue(new Error('请先完成云存储配置'));

    await expect(
      pullCloudSync(runtime, jest.fn(async () => freshRuntime)),
    ).rejects.toBeDefined();

    expect(isMobileDbMaintenanceBusy()).toBe(false);
    // `!= null` 守卫的唯一钉点：createCoordinator 抛错时两个临时路径都还是
    // undefined，unlink 绝不能以 undefined 被调用（同步抛 TypeError 会用
    // 一个新错盖掉原始错，把「配置不全」报成「临时文件清理失败」）。
    expect(mockUnlink).not.toHaveBeenCalledWith(undefined);
    // 弱断言：错因是配置没填全，与网络毫无关系；兜底分支会把它误报成
    // 「请检查网络」这种误导引导。
    await pullCloudSync(runtime, jest.fn(async () => freshRuntime)).catch(
      (error: Error) => {
        expect(error.message).not.toMatch(/网络/);
      },
    );
  });

  it('coordinator.pull 失败时两个临时文件都被清理且参数为完整路径', async () => {
    mockCoordinatorPull.mockRejectedValue(new Error('快照校验失败'));
    const rebootstrap = jest.fn(async () => freshRuntime);

    await expect(pullCloudSync(runtime, rebootstrap)).rejects.toBeDefined();

    expect(mockUnlink).toHaveBeenCalledTimes(2);
    const unlinkedArgs = mockUnlink.mock.calls.map(call => call[0]);
    for (const arg of unlinkedArgs) {
      expect(typeof arg).toBe('string');
      expect(String(arg)).toContain('/cache/cloud-sync-');
    }
  });
});

describe('pushCloudSync', () => {
  it('推送成功时更新 lastSyncedRev', async () => {
    mockCoordinatorPush.mockResolvedValue({rev: 2});

    const result = await pushCloudSync(runtime, undefined);

    expect(result).toEqual({rev: 2});
    expect(mockCoordinatorPush).toHaveBeenCalledWith({
      lastSyncedRev: 1,
      forceOverwriteRemote: undefined,
    });
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        lastSyncedRev: 2,
        lastPushResult: 'success',
      }),
    );
  });

  it('NEED_PULL_FIRST 时向上抛出', async () => {
    mockCoordinatorPush.mockRejectedValue(
      new CloudSyncError('NEED_PULL_FIRST', '云端有更新，请先拉取'),
    );

    await expect(pushCloudSync(runtime, undefined)).rejects.toMatchObject({
      code: 'NEED_PULL_FIRST',
    });
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPushResult: 'error'}),
    );
  });
});
