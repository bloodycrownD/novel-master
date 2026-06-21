import {CloudSyncError} from '@novel-master/core';
import {
  pullCloudSync,
  pushCloudSync,
  sha256Hex,
  testCloudSyncConnection,
} from '../src/services/cloud-sync.service';

const mockGetConfig = jest.fn();
const mockGetLocalStatus = jest.fn();
const mockPatchLocalStatus = jest.fn();
const mockBuildS3Config = jest.fn();
const mockCreateS3Storage = jest.fn();
const mockExportToPath = jest.fn();
const mockImportFromBytes = jest.fn();
const mockAgentActive = jest.fn();
const mockCoordinatorPull = jest.fn();
const mockCoordinatorPush = jest.fn();
const mockHeadBucket = jest.fn();
const mockListObjects = jest.fn();
const mockUnlink = jest.fn();
const mockReadFile = jest.fn();
const mockStat = jest.fn();

jest.mock('../src/services/cloud-sync-config.store', () => ({
  CLOUD_SYNC_KKV_MODULE: 'nm-cloud-sync',
  CLOUD_SYNC_SECRET_REF: 'cloud-sync/s3-secret-key',
  DEFAULT_CLOUD_SYNC_PATH_PREFIX: 'novel-master/sync/',
  getCloudSyncConfig: (...args: unknown[]) => mockGetConfig(...args),
  getCloudSyncLocalStatus: (...args: unknown[]) => mockGetLocalStatus(...args),
  patchCloudSyncLocalStatus: (...args: unknown[]) => mockPatchLocalStatus(...args),
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

jest.mock('../src/services/db-backup.service', () => ({
  exportDatabaseBackupToPath: (...args: unknown[]) => mockExportToPath(...args),
  importDatabaseBackupFromBytes: (...args: unknown[]) =>
    mockImportFromBytes(...args),
}));

jest.mock('../src/runtime/agent-activity', () => ({
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
  it('拉取成功时更新 lastSyncedRev 并触发 rebootstrap', async () => {
    mockCoordinatorPull.mockResolvedValue({rev: 3});
    const rebootstrap = jest.fn();

    const result = await pullCloudSync(runtime, rebootstrap);

    expect(result).toEqual({rev: 3, alreadyUpToDate: false});
    expect(mockCoordinatorPull).toHaveBeenCalledWith({lastSyncedRev: 1});
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({
        lastSyncedRev: 3,
        lastPullResult: 'success',
      }),
    );
    expect(rebootstrap).toHaveBeenCalled();
    expect(mockImportFromBytes).not.toHaveBeenCalled();
  });

  it('ALREADY_UP_TO_DATE 时不触发 rebootstrap', async () => {
    mockCoordinatorPull.mockRejectedValue(
      new CloudSyncError('ALREADY_UP_TO_DATE', '本地已是最新，无需拉取'),
    );
    const rebootstrap = jest.fn();

    const result = await pullCloudSync(runtime, rebootstrap);

    expect(result).toEqual({rev: 1, alreadyUpToDate: true});
    expect(rebootstrap).not.toHaveBeenCalled();
    expect(mockPatchLocalStatus).toHaveBeenCalledWith(
      runtime,
      expect.objectContaining({lastPullResult: 'already_up_to_date'}),
    );
  });

  it('未配置时抛 NOT_CONFIGURED', async () => {
    mockGetLocalStatus.mockResolvedValue({
      configured: false,
      deviceId: '',
      lastSyncedRev: 0,
    });

    await expect(pullCloudSync(runtime, jest.fn())).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
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
