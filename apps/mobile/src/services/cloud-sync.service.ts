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
import type {CloudSyncProgressListener} from './cloud-sync-progress-ui';
import {createS3ObjectStorage} from '@novel-master/cloud-sync-driver-s3';
import {
  HeadBucketCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import {createRnS3Client} from '@/shims/aws-rn-s3-client';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {Buffer} from 'buffer';
import type {S3StorageConfig} from '@novel-master/cloud-sync-driver-s3';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {isMobileAgentActive} from '@/runtime/agent-activity';
import {
  DatabaseReplacedError,
  exportDatabaseBackupToPath,
  importDatabaseBackupFromBytes,
  importDatabaseBackupFromPath,
} from './db-backup.service';
import {
  acquireMobileDbMaintenanceBusy,
  releaseMobileDbMaintenanceBusy,
} from './db-maintenance-busy';
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
  /** 同步阶段进度，供 UI 遮罩/进度条使用 */
  onProgress?: CloudSyncProgressListener;
};

export type CloudSyncPullOptions = {
  onProgress?: CloudSyncProgressListener;
};

export type {
  CloudSyncProgressListener,
  CloudSyncProgressUiState,
} from './cloud-sync-progress-ui';
export {initialCloudSyncProgressUi} from './cloud-sync-progress-ui';

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
    // mobile 端注入基于 react-native-blob-util 的 FileSystemPort（对应 A-26）。
    fileSystem: {
      readFile: readFileBytes,
      writeFile: async (path, bytes) => {
        await ReactNativeBlobUtil.fs.writeFile(
          path,
          Buffer.from(bytes).toString('base64'),
          'base64',
        );
      },
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
    // dbSync 三条快照路径直调 db-backup 底层函数（不经上层备份包装）：
    // busy 互斥由底层 exportDatabaseBackupToPath / importDatabaseBackup
    // 系列内部的 acquire/release 计数配对覆盖——快照导出与「关连接 +
    // 覆盖库文件」窗口期间归一/压缩后台循环让路；pull 侧 rebootstrap
    // 之后的重建窗口由 pullCloudSync 的外层 acquire/release 兜住。
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
        // 必须 return：不 return 完全合法、零类型错误，但运行时
        // databaseReplaced === undefined ⇒ pullCloudSync 永不重建 runtime ⇒
        // 后续所有记账/读写绑在已关连接上。
        const outcome = await importDatabaseBackupFromBytes(bytes);
        progress?.step('db_import_done', {ms: Date.now() - importStart});
        return outcome;
      },
      importSnapshotFromPath: async path => {
        progress?.step('db_import_start', {fromPath: true});
        const importStart = Date.now();
        const outcome = await importDatabaseBackupFromPath(path);
        progress?.step('db_import_done', {ms: Date.now() - importStart});
        return outcome;
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
    input?.pathPrefix?.trim() || (await getCloudSyncConfig(runtime)).pathPrefix,
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

/**
 * 云同步互斥（pull ↔ push）。
 *
 * mobile 侧没有 desktop 那样的模块级 `syncBusy` 守卫：pull 与 push 是两个
 * 各自独立的导出函数，除 maintenanceBusy 计数外无任何互斥。交错后果是
 * 「push 在 t0 拷完库 → pull 在 t1 整库替换 → push 在 t2 上传 t0 的旧快照
 * 并把 rev 推到 t1+1」⇒ pull 拉回来的内容被云端回滚，且本机 lastSyncedRev
 * 被推到更高值，之后再也不会重新拉。
 *
 * desktop 侧的 `syncBusy` 是「检查与置位之间无 await、单线程下原子」的自愈形态，
 * mobile 对齐同一口径。检查与置位必须落在 `acquireMobileDbMaintenanceBusy()`
 * 之前或已建立的 `try` 内——落在两者之间（try 之外）会原样复现令牌泄漏形态。
 */
let syncBusy = false;

/**
 * 从云端拉取快照并导入。
 *
 * 契约顺序：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
 * 换库由 `coordinator.pull()` 内的导入函数完成，它会关掉 `runtime` 背后的连接
 * ⇒ 换代成功时**绝不能用旧 runtime 记账**（会抛 `CONNECTION_CLOSED`，
 * 且抛错发生在记录成功之前，把已完成的拉取记成失败，rev 永不推进）。
 *
 * 令牌纪律：**令牌在 acquire 之后的第一个 `await` 之前，必须已被 `try` 覆盖**
 * ——acquire 与 try 之间不允许出现任何可抛表达式。对照 desktop
 * `cloud-sync.service.ts` 的 getLocalMeta 搬移注释，这正是它当初被写下来的原因。
 */
export async function pullCloudSync(
  runtime: MobileNovelMasterRuntime,
  onRebootstrap: () => Promise<MobileNovelMasterRuntime>,
  options?: CloudSyncPullOptions,
): Promise<CloudSyncPullOutcome> {
  const local = await getCloudSyncLocalStatus(runtime);
  if (!local.configured) {
    throw new CloudSyncError('NOT_CONFIGURED', '请先配置云存储');
  }

  if (syncBusy) {
    throw new Error('云同步进行中，请稍后再试');
  }
  syncBusy = true;

  // 外层 acquire（计数/令牌配对）：底层导入函数的 acquire/release 只
  // 覆盖到它自己返回，「库文件已替换、连接仍处重建窗口」的尾段由这层
  // 兜住——release 必须发生在重建 + 记账完成之后（含重建窗口的
  // 完整互斥），其余出口（错误 / already-up-to-date）由 finally 兜底，
  // 令牌标记保证幂等不重复 release。
  acquireMobileDbMaintenanceBusy();
  let pullBusyHeld = true;
  const releasePullBusy = (): void => {
    if (pullBusyHeld) {
      pullBusyHeld = false;
      releaseMobileDbMaintenanceBusy();
    }
  };

  // progress / coordinator / 临时路径都先声明再赋值：createCloudSyncProgress
  // 与 createCoordinator 都在 try 内，但 catch 里要引用 progress（需 ?.），
  // finally 里要引用临时路径（需 != null 守卫）——不提升就会 TDZ，
  // 或让 `unlink(undefined)` 用一个新错盖掉原始错。
  let progress: ReturnType<typeof createCloudSyncProgress> | undefined;
  let coordinator: CloudSyncCoordinator;
  let exportTempPath: string | undefined;
  let importTempPath: string | undefined;
  // catch 分支要用它记账，必须声明在 try 之外。
  const now = new Date().toISOString();
  // 记账用的 runtime：pull 未换代时是传入的 runtime，换代成功后换成重建出来的新
  // runtime。catch 分支同样只能用它，绝不写回已作废的那一代。
  let accountingRuntime: MobileNovelMasterRuntime = runtime;

  try {
    progress = createCloudSyncProgress('pull', {
      onUiProgress: options?.onProgress,
    });
    progress.step('start', {lastSyncedRev: local.lastSyncedRev});
    const created = await createCoordinator(runtime, undefined, progress);
    coordinator = created.coordinator;
    exportTempPath = created.exportTempPath;
    importTempPath = created.importTempPath;

    progress.step('coordinator_pull_start', {});
    const result = await coordinator.pull({
      lastSyncedRev: local.lastSyncedRev,
    });
    if (result.databaseReplaced) {
      // 先重建，再用新 runtime 记账。
      accountingRuntime = await onRebootstrap();
      await patchCloudSyncLocalStatus(accountingRuntime, {
        lastSyncedRev: result.rev,
        lastPullAt: now,
        lastPullResult: 'success',
      });
    } else {
      // 这条分支不换代（库没换、连接没关），所以记账可以用旧 runtime。
      await patchCloudSyncLocalStatus(runtime, {
        lastPullAt: now,
        lastPullResult: 'already_up_to_date',
      });
    }
    // 重建 + 记账已完成，重建窗口结束，此处释放外层互斥（finally 兜底幂等）。
    releasePullBusy();
    progress.done({rev: result.rev});
    return {rev: result.rev, alreadyUpToDate: false};
  } catch (error) {
    if (isCloudSyncError(error) && error.code === 'ALREADY_UP_TO_DATE') {
      await patchCloudSyncLocalStatus(runtime, {
        lastPullAt: now,
        lastPullResult: 'already_up_to_date',
      });
      progress?.done({rev: local.lastSyncedRev, alreadyUpToDate: true});
      return {rev: local.lastSyncedRev, alreadyUpToDate: true};
    }
    if (error instanceof DatabaseReplacedError) {
      // 库已换代但后续步骤抛错：runtime 换代优先于报错。mobile 的 runtime 是
      // React state、没有 desktop `getDesktopRuntime()` 的懒建自愈 ⇒ 不补这条，
      // 一次失败 pull 之后整个 App 带着已关 runtime 跑到用户手动重启。
      try {
        accountingRuntime = await onRebootstrap();
      } catch {
        // 重建失败不掩盖原始错误：下面的记账仍会用（可能已关的）旧 runtime，
        // 但它挂了 .catch，不会二次抛出。
      }
    }
    await patchCloudSyncLocalStatus(accountingRuntime, {
      lastPullAt: now,
      lastPullResult: 'error',
    }).catch(() => undefined);
    progress?.fail(error);
    throw mapSdkError(error);
  } finally {
    syncBusy = false;
    releasePullBusy();
    if (exportTempPath != null) {
      await ReactNativeBlobUtil.fs
        .unlink(exportTempPath)
        .catch(() => undefined);
    }
    if (importTempPath != null) {
      await ReactNativeBlobUtil.fs
        .unlink(importTempPath)
        .catch(() => undefined);
    }
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

  if (syncBusy) {
    throw new Error('云同步进行中，请稍后再试');
  }
  syncBusy = true;

  const progress = createCloudSyncProgress('push', {
    onUiProgress: options?.onProgress,
  });
  progress.step('start', {
    lastSyncedRev: local.lastSyncedRev,
    forceOverwriteRemote: options?.forceOverwriteRemote ?? false,
  });

  const now = new Date().toISOString();
  try {
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
      if (exportTempPath != null) {
        await ReactNativeBlobUtil.fs
          .unlink(exportTempPath)
          .catch(() => undefined);
      }
    }
  } finally {
    syncBusy = false;
  }
}

export {
  getCloudSyncConfig,
  setCloudSyncConfig,
  type CloudSyncConfigInput,
  type CloudSyncConfigPublic,
  type CloudSyncLocalStatus,
} from './cloud-sync-config.store';
