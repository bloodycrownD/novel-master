import {AppError, DatabaseReplacedError, Result} from '@novel-master/core';
import {isAbortLikeError} from '@novel-master/core/llm-protocol';
import {ABORT_KEY, createAbortError, createAbortRegistry} from '@novel-master/core/abort';
import {
  pullCloudSync,
  pushCloudSync,
  sha256Hex,
  testCloudSyncConnection,
} from '@/services/cloud-sync.service';
import {maintenanceBusy} from '@/services/db-maintenance-busy';

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
}));

jest.mock('@/runtime/agent-activity', () => ({
  agentActivity: {isActive: () => mockAgentActive()},
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
  // 泛化取消注册表（signal-abort-scope Step 11）：云同步任务级 scope 登记处。
  abortRegistry: createAbortRegistry(),
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
    ok: true,
    value: {
      endpoint: 'https://s3.example.com',
    bucket: 'test-bucket',
    region: '',
    pathPrefix: 'novel-master/sync/',
    accessKeyId: 'ak',
    forcePathStyle: true,
    deviceId: 'device-1',
    secretKeySet: true,
    },
  });
  mockGetLocalStatus.mockResolvedValue({
    ok: true,
    value: {
      configured: true,
      deviceId: 'device-1',
      lastSyncedRev: 1,
    },
  });
  mockBuildS3Config.mockResolvedValue({
    ok: true,
    value: {
      endpoint: 'https://s3.example.com',
    bucket: 'test-bucket',
    region: '',
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    forcePathStyle: true,
    },
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
    await expect(testCloudSyncConnection(runtime)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(mockHeadBucket).toHaveBeenCalled();
  });

  it('SDK 抛出 Deserialization error 时 reject 为用户向中文 message', async () => {
    const sdkError = new Error(
      'Deserialization error: Unable to parse response body',
    );
    mockHeadBucket.mockRejectedValue(sdkError);
    mockListObjects.mockRejectedValue(sdkError);

    await expect(testCloudSyncConnection(runtime)).rejects.toMatchObject({
      key: 'CLOUD_SYNC_NETWORK',
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
    while (maintenanceBusy.isBusy()) {
      maintenanceBusy.release();
    }
  });

  it('拉取换代成功时先 onRebootstrap 再用新 runtime 记账', async () => {
    mockCoordinatorPull.mockResolvedValue(Result.ok({rev: 3, databaseReplaced: true}));
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

    expect(result).toEqual({ok: true, value: {rev: 3, alreadyUpToDate: false}});
    // checkpoint 由 service 注入，coordinator 在真实阶段边界调它（T-S16）。
    expect(mockCoordinatorPull).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedRev: 1,
        checkpoint: expect.any(Function),
      }),
    );
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
    mockCoordinatorPull.mockResolvedValue(Result.ok({rev: 3, databaseReplaced: false}));
    const rebootstrap = jest.fn(async () => freshRuntime);

    const result = await pullCloudSync(runtime, rebootstrap);

    expect(result).toEqual({ok: true, value: {rev: 3, alreadyUpToDate: false}});
    expect(rebootstrap).not.toHaveBeenCalled();
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPullResult: 'already_up_to_date'}),
    );
  });

  it('ALREADY_UP_TO_DATE 时不调用 onRebootstrap 且记账走旧 runtime', async () => {
    // coordinator 的业务失败沿 Result 回传（错误通道迁移四期）：不 reject。
    mockCoordinatorPull.mockResolvedValue(
      Result.err(new AppError('CLOUD_SYNC_ALREADY_UP_TO_DATE', {detail: '本地已是最新，无需拉取'})),
    );
    const rebootstrap = jest.fn(async () => freshRuntime);

    const result = await pullCloudSync(runtime, rebootstrap);

    expect(result).toEqual({ok: true, value: {rev: 1, alreadyUpToDate: true}});
    expect(rebootstrap).not.toHaveBeenCalled();
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPullResult: 'already_up_to_date'}),
    );
  });

  it('catch 分支在 pull 已换代时先重建再用新 runtime 记账', async () => {
    mockCoordinatorPull.mockRejectedValue(
      new DatabaseReplacedError('数据库已导入，但本机服务商配置恢复失败', false),
    );
    const rebootstrap = jest.fn(async () => freshRuntime);

    const failed = await pullCloudSync(runtime, rebootstrap);
    expect(failed.ok).toBe(false);

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
      ok: true,
      value: {
        configured: false,
        deviceId: '',
        lastSyncedRev: 0,
      },
    });

    const denied = await pullCloudSync(runtime, jest.fn(async () => freshRuntime));
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toMatchObject({key: 'CLOUD_SYNC_NOT_CONFIGURED'});
    }
  });

  it('createCoordinator 抛错时 reject 且 maintenanceBusy.isBusy() 回到 false', async () => {
    // S-CS-04 主断言（必红→必绿）：acquire 令牌之后到 try 之间原本有一段
    // 可抛代码（createCoordinator），它一抛 finally 就不执行 ⇒
    // maintenanceBusyCount 永久 +1 ⇒ 消息解压 / blob 归一两个后台循环在本进程
    // 剩余生命周期内全部停摆，而用户侧零报错。
    // 反向断言：调用前先确认计数是干净的——否则本条的 `=== false` 会恒红，
    // 而上一条若把它配平了，本条的「泄漏」就观测不到。
    expect(maintenanceBusy.isBusy()).toBe(false);
    mockBuildS3Config.mockResolvedValue({
      ok: false,
      error: new Error('请先完成云存储配置'),
    });

    const deniedCoordinator = await pullCloudSync(
      runtime,
      jest.fn(async () => freshRuntime),
    );
    expect(deniedCoordinator.ok).toBe(false);

    expect(maintenanceBusy.isBusy()).toBe(false);
    // `!= null` 守卫的唯一钉点：createCoordinator 失败时两个临时路径都还是
    // undefined，unlink 绝不能以 undefined 被调用（同步抛 TypeError 会用
    // 一个新错盖掉原始错，把「配置不全」报成「临时文件清理失败」）。
    expect(mockUnlink).not.toHaveBeenCalledWith(undefined);
    // 弱断言：错因是配置没填全，与网络毫无关系；兜底分支会把它误报成
    // 「请检查网络」这种误导引导。
    const deniedAgain = await pullCloudSync(
      runtime,
      jest.fn(async () => freshRuntime),
    );
    if (!deniedAgain.ok) {
      expect(String(deniedAgain.error)).not.toMatch(/网络/);
    }
  });

  it('coordinator.pull 失败时两个临时文件都被清理且参数为完整路径', async () => {
    mockCoordinatorPull.mockResolvedValue(Result.err(new Error('快照校验失败')));
    const rebootstrap = jest.fn(async () => freshRuntime);

    const failed = await pullCloudSync(runtime, rebootstrap);
    expect(failed.ok).toBe(false);

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
    mockCoordinatorPush.mockResolvedValue(Result.ok({rev: 2}));

    const result = await pushCloudSync(runtime, undefined);

    expect(result).toEqual({ok: true, value: {rev: 2}});
    expect(mockCoordinatorPush).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncedRev: 1,
        forceOverwriteRemote: undefined,
        checkpoint: expect.any(Function),
      }),
    );
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        lastSyncedRev: 2,
        lastPushResult: 'success',
      }),
    );
  });

  it('NEED_PULL_FIRST 时沿 Result.err 上行', async () => {
    // coordinator 的业务失败沿 Result 回传（错误通道迁移四期）：不 reject。
    mockCoordinatorPush.mockResolvedValue(
      Result.err(new AppError('CLOUD_SYNC_NEED_PULL_FIRST', {detail: '云端有更新，请先拉取'})),
    );

    const result = await pushCloudSync(runtime, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({key: 'CLOUD_SYNC_NEED_PULL_FIRST'});
    }
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPushResult: 'error'}),
    );
  });
});

/**
 * T-S16：移动云同步任务级取消。
 *
 * 取消经 `runtime.abortRegistry.abort(ABORT_KEY.cloudSync('local'))` 派发；
 * 协调器在下一个真实阶段边界抛 AbortError，service 出口**原样上抛**——
 * 账本记 cancelled、进度走取消终态、临时文件仍由 finally 清理。
 */
describe('云同步任务级取消（T-S16）', () => {
  const cancelKey = ABORT_KEY.cloudSync('local');

  async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => null,
      (error: unknown) => error,
    );
  }

  it('pull：异步段 abort 后 promise 以 AbortError 原样 reject、账本记 cancelled、进度进终态', async () => {
    const onProgress = jest.fn();
    mockCoordinatorPull.mockImplementation(async (options: {checkpoint?: () => unknown}) => {
      // 协调器在真实阶段边界命中：先由用户取消，再问 checkpoint。
      runtime.abortRegistry.abort(cancelKey);
      expect(options.checkpoint?.()).toEqual({kind: 'cancelled', reason: 'user-stop'});
      throw createAbortError();
    });

    const error = await captureRejection(pullCloudSync(runtime, jest.fn(), {onProgress}));

    // 原样上抛：不得被 mapCloudSyncSdkError 包成 CLOUD_SYNC_NETWORK。
    expect(isAbortLikeError(error)).toBe(true);
    expect(error).not.toMatchObject({key: 'CLOUD_SYNC_NETWORK'});
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPullResult: 'cancelled'}),
    );
    expect(mockPatchLocalStatus).not.toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPullResult: 'error'}),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({op: 'pull', event: 'pull_cancelled', progress: 1}),
    );
    // finally 反注册：任务结束后 key 不残留。
    expect(runtime.abortRegistry.has(cancelKey)).toBe(false);
  });

  it('push：异步段 abort 后同上，且临时导出文件照常清理', async () => {
    const onProgress = jest.fn();
    mockCoordinatorPush.mockImplementation(async (options: {checkpoint?: () => unknown}) => {
      runtime.abortRegistry.abort(cancelKey, 'timeout');
      expect(options.checkpoint?.()).toEqual({kind: 'cancelled', reason: 'timeout'});
      throw createAbortError();
    });

    const error = await captureRejection(pushCloudSync(runtime, {onProgress}));

    expect(isAbortLikeError(error)).toBe(true);
    expect(error).not.toMatchObject({key: 'CLOUD_SYNC_NETWORK'});
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPushResult: 'cancelled'}),
    );
    expect(mockPatchLocalStatus).not.toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPushResult: 'error'}),
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({op: 'push', event: 'push_cancelled', progress: 1}),
    );
    expect(mockUnlink.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('/cache/cloud-sync-export-'),
    ]);
    expect(runtime.abortRegistry.has(cancelKey)).toBe(false);
  });

  it('coordinator 的业务失败（Result.err）仍沿 Result 上行，不误判成取消', async () => {
    const onProgress = jest.fn();
    mockCoordinatorPush.mockResolvedValue(Result.err(new AppError('CLOUD_SYNC_LOCK_HELD_BY_OTHER', {detail: '锁被占用'})));

    const result = await pushCloudSync(runtime, {onProgress});

    expect(result.ok).toBe(false);
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPushResult: 'error'}),
    );
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({event: 'push_cancelled'}));
  });
});
