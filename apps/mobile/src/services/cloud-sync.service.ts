/**
 * Mobile 云同步：组装 CloudSyncCoordinator、S3 驱动与 DbSyncPort。
 *
 * @module services/cloud-sync.service
 */
import {
  CloudSyncCoordinator,
  CloudSyncError,
  isCloudSyncError,
  normalizePrefix,
  parseCloudSyncStatus,
  statusKey,
} from '@novel-master/core';
import {mapCloudSyncSdkError} from './map-cloud-sync-sdk-error';
import {
  createCloudSyncProgress,
  withCloudSyncStorageProgress,
} from './cloud-sync-progress-log';
import {createS3ObjectStorage} from '@novel-master/cloud-sync-driver-s3';
import {
  HeadBucketCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import {createRnS3Client} from '../shims/aws-rn-s3-client';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {Buffer} from 'buffer';
import type {S3StorageConfig} from '@novel-master/cloud-sync-driver-s3';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {isMobileAgentActive} from '../runtime/agent-activity';
import {
  exportDatabaseBackupToPath,
  importDatabaseBackupFromBytes,
  importDatabaseBackupFromPath,
} from './db-backup.service';
import {hashSnapshotFile, sha256Hex} from './snapshot-file-hash';
import {
  buildS3StorageConfig,
  getCloudSyncConfig,
  getCloudSyncLocalStatus,
  patchCloudSyncLocalStatus,
  type CloudSyncConfigInput,
  type CloudSyncConfigPublic,
  type CloudSyncLocalStatus,
} from './cloud-sync-config.store';

export type CloudSyncStatusView = CloudSyncLocalStatus & {
  remoteRev: number;
  suggestPull: boolean;
};

export type CloudSyncPullOutcome = {
  rev: number;
  alreadyUpToDate: boolean;
};

export type CloudSyncPushOptions = {
  forceOverwriteRemote?: boolean;
};

/** @deprecated 请使用 snapshot-file-hash 模块导出 */
export {sha256Hex} from './snapshot-file-hash';

type Utf8Decoder = {decode: (input: Uint8Array) => string};
type Utf8DecoderCtor = new () => Utf8Decoder;

function decodeUtf8Bytes(bytes: Uint8Array): string {
  const Decoder = (globalThis as {TextDecoder?: Utf8DecoderCtor}).TextDecoder;
  if (typeof Decoder === 'function') {
    return new Decoder().decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

async function readFileBytes(path: string): Promise<Uint8Array> {
  const base64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

async function getFileSize(path: string): Promise<number> {
  const stat = await ReactNativeBlobUtil.fs.stat(path);
  return Number(stat.size);
}

function buildS3Client(config: S3StorageConfig): S3Client {
  return createRnS3Client(config);
}

function mapSdkError(error: unknown): CloudSyncError {
  return mapCloudSyncSdkError(error);
}

async function readRemoteRev(
  runtime: MobileNovelMasterRuntime,
  s3Config?: S3StorageConfig,
): Promise<number> {
  const config = s3Config ?? (await buildS3StorageConfig(runtime));
  const storage = createS3ObjectStorage(config, {
    client: createRnS3Client(config),
  });
  const pathPrefix = (await getCloudSyncConfig(runtime)).pathPrefix;
  const key = statusKey(pathPrefix);
  const head = await storage.head(key);
  if (!head.exists) {
    return 0;
  }
  const {body} = await storage.get(key);
  try {
    const parsed = JSON.parse(decodeUtf8Bytes(body));
    return parseCloudSyncStatus(parsed).rev;
  } catch (error) {
    throw new CloudSyncError('INVALID_STATUS', '云端状态文件无法解析', {
      cause: error,
    });
  }
}

async function createCoordinator(
  runtime: MobileNovelMasterRuntime,
  s3Config?: S3StorageConfig,
  progress?: ReturnType<typeof createCloudSyncProgress>,
): Promise<{
  coordinator: CloudSyncCoordinator;
  pathPrefix: string;
  exportTempPath: string;
  importTempPath: string;
}> {
  const publicConfig = await getCloudSyncConfig(runtime);
  const storageConfig = s3Config ?? (await buildS3StorageConfig(runtime));
  const baseStorage = createS3ObjectStorage(storageConfig, {
    client: createRnS3Client(storageConfig),
    readFile: readFileBytes,
    writeFile: async (path, bytes) => {
      await ReactNativeBlobUtil.fs.writeFile(
        path,
        Buffer.from(bytes).toString('base64'),
        'base64',
      );
    },
  });
  const storage =
    progress != null
      ? withCloudSyncStorageProgress(baseStorage, progress)
      : baseStorage;
  const pathPrefix = normalizePrefix(publicConfig.pathPrefix);
  const stamp = Date.now();
  const exportTempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/cloud-sync-export-${stamp}.nmbackup`;
  const importTempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/cloud-sync-import-${stamp}.nmbackup`;

  const coordinator = new CloudSyncCoordinator({
    storage,
    pathPrefix,
    deviceId: publicConfig.deviceId,
    exportTempPath,
    importTempPath,
    computeSha256Hex: bytes => {
      progress?.step('sha256_start', {bytes: bytes.byteLength});
      const hashStart = Date.now();
      const hash = sha256Hex(bytes);
      progress?.step('sha256_done', {ms: Date.now() - hashStart});
      return hash;
    },
    hashSnapshotFile: async path => {
      progress?.step('sha256_file_start', {});
      const hashStart = Date.now();
      const hash = await hashSnapshotFile(path);
      progress?.step('sha256_file_done', {ms: Date.now() - hashStart});
      return hash;
    },
    readSnapshotBytes: async path => {
      progress?.step('read_snapshot_start', {});
      const readStart = Date.now();
      const bytes = await readFileBytes(path);
      progress?.step('read_snapshot_done', {
        bytes: bytes.byteLength,
        ms: Date.now() - readStart,
      });
      return bytes;
    },
    getSnapshotBytes: getFileSize,
    dbSync: {
      isAgentActive: () => isMobileAgentActive(),
      exportSnapshotToPath: async dest => {
        progress?.step('db_export_start', {});
        const exportStart = Date.now();
        await exportDatabaseBackupToPath(runtime, dest);
        const bytes = await getFileSize(dest);
        progress?.step('db_export_done', {
          bytes,
          ms: Date.now() - exportStart,
        });
      },
      importSnapshot: async bytes => {
        progress?.step('db_import_start', {bytes: bytes.byteLength});
        const importStart = Date.now();
        await importDatabaseBackupFromBytes(bytes);
        progress?.step('db_import_done', {ms: Date.now() - importStart});
      },
      importSnapshotFromPath: async path => {
        progress?.step('db_import_start', {fromPath: true});
        const importStart = Date.now();
        await importDatabaseBackupFromPath(path);
        progress?.step('db_import_done', {ms: Date.now() - importStart});
      },
    },
  });

  return {coordinator, pathPrefix, exportTempPath, importTempPath};
}

/** 读取本机状态与云端 rev，供 Profile 展示。 */
export async function getCloudSyncStatusView(
  runtime: MobileNovelMasterRuntime,
): Promise<CloudSyncStatusView> {
  const local = await getCloudSyncLocalStatus(runtime);
  if (!local.configured) {
    return {...local, remoteRev: 0, suggestPull: false};
  }
  try {
    const remoteRev = await readRemoteRev(runtime);
    return {
      ...local,
      remoteRev,
      suggestPull: remoteRev > local.lastSyncedRev,
    };
  } catch {
    return {...local, remoteRev: 0, suggestPull: false};
  }
}

/** 测试 S3 连接（HeadBucket 或 ListObjectsV2，不读写 status.json）。 */
export async function testCloudSyncConnection(
  runtime: MobileNovelMasterRuntime,
  input?: CloudSyncConfigInput,
): Promise<void> {
  const s3Config = input
    ? await buildS3StorageConfig(runtime, input)
    : await buildS3StorageConfig(runtime);
  const client = buildS3Client(s3Config);
  const pathPrefix = normalizePrefix(
    input?.pathPrefix?.trim() ||
      (await getCloudSyncConfig(runtime)).pathPrefix,
  );

  const progress = createCloudSyncProgress('test');
  progress.step('start', {bucket: s3Config.bucket, prefix: pathPrefix});

  try {
    progress.step('head_bucket_start', {});
    await client.send(new HeadBucketCommand({Bucket: s3Config.bucket}));
    progress.done({via: 'HeadBucket'});
  } catch (headError) {
    progress.step('head_bucket_failed', {
      error: headError instanceof Error ? headError.message : String(headError),
    });
    try {
      progress.step('list_objects_start', {});
      await client.send(
        new ListObjectsV2Command({
          Bucket: s3Config.bucket,
          Prefix: pathPrefix,
          MaxKeys: 1,
        }),
      );
      progress.done({via: 'ListObjectsV2'});
    } catch (listError) {
      progress.fail(listError ?? headError);
      throw mapSdkError(listError ?? headError);
    }
  }
}

/** 从云端拉取快照并导入；成功后须调用 onRebootstrap。 */
export async function pullCloudSync(
  runtime: MobileNovelMasterRuntime,
  onRebootstrap: () => void,
): Promise<CloudSyncPullOutcome> {
  const local = await getCloudSyncLocalStatus(runtime);
  if (!local.configured) {
    throw new CloudSyncError('NOT_CONFIGURED', '请先配置云存储');
  }

  const progress = createCloudSyncProgress('pull');
  progress.step('start', {lastSyncedRev: local.lastSyncedRev});

  const now = new Date().toISOString();
  const {coordinator, exportTempPath, importTempPath} = await createCoordinator(
    runtime,
    undefined,
    progress,
  );

  try {
    progress.step('coordinator_pull_start', {});
    const result = await coordinator.pull({lastSyncedRev: local.lastSyncedRev});
    await patchCloudSyncLocalStatus(runtime, {
      lastSyncedRev: result.rev,
      lastPullAt: now,
      lastPullResult: 'success',
    });
    onRebootstrap();
    progress.done({rev: result.rev});
    return {rev: result.rev, alreadyUpToDate: false};
  } catch (error) {
    if (
      isCloudSyncError(error) &&
      error.code === 'ALREADY_UP_TO_DATE'
    ) {
      await patchCloudSyncLocalStatus(runtime, {
        lastPullAt: now,
        lastPullResult: 'already_up_to_date',
      });
      progress.done({rev: local.lastSyncedRev, alreadyUpToDate: true});
      return {rev: local.lastSyncedRev, alreadyUpToDate: true};
    }
    await patchCloudSyncLocalStatus(runtime, {
      lastPullAt: now,
      lastPullResult: 'error',
    });
    progress.fail(error);
    throw mapSdkError(error);
  } finally {
    await ReactNativeBlobUtil.fs.unlink(exportTempPath).catch(() => undefined);
    await ReactNativeBlobUtil.fs.unlink(importTempPath).catch(() => undefined);
  }
}

/** 推送本机快照到云端（不触发 rebootstrap）。 */
export async function pushCloudSync(
  runtime: MobileNovelMasterRuntime,
  options: CloudSyncPushOptions | undefined,
): Promise<{rev: number}> {
  const local = await getCloudSyncLocalStatus(runtime);
  if (!local.configured) {
    throw new CloudSyncError('NOT_CONFIGURED', '请先配置云存储');
  }

  const progress = createCloudSyncProgress('push');
  progress.step('start', {
    lastSyncedRev: local.lastSyncedRev,
    forceOverwriteRemote: options?.forceOverwriteRemote ?? false,
  });

  const now = new Date().toISOString();
  const {coordinator, exportTempPath} = await createCoordinator(
    runtime,
    undefined,
    progress,
  );

  try {
    progress.step('coordinator_push_start', {});
    const result = await coordinator.push({
      lastSyncedRev: local.lastSyncedRev,
      forceOverwriteRemote: options?.forceOverwriteRemote,
    });
    await patchCloudSyncLocalStatus(runtime, {
      lastSyncedRev: result.rev,
      lastPushAt: now,
      lastPushResult: 'success',
    });
    progress.done({rev: result.rev});
    return result;
  } catch (error) {
    await patchCloudSyncLocalStatus(runtime, {
      lastPushAt: now,
      lastPushResult: 'error',
    });
    progress.fail(error);
    throw mapSdkError(error);
  } finally {
    await ReactNativeBlobUtil.fs.unlink(exportTempPath).catch(() => undefined);
  }
}

export {
  getCloudSyncConfig,
  setCloudSyncConfig,
  type CloudSyncConfigInput,
  type CloudSyncConfigPublic,
  type CloudSyncLocalStatus,
} from './cloud-sync-config.store';
