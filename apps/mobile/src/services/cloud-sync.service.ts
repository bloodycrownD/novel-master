/**
 * Mobile 云同步：组装 CloudSyncCoordinator、S3 驱动与 DbSyncPort。
 *
 * @module services/cloud-sync.service
 */
import {CloudSyncCoordinator, CloudSyncPaths, CloudSyncStatusParser, DatabaseReplacedError} from '@novel-master/core';
import {Path} from '@novel-master/core/common';
import {RequestAbort} from '@novel-master/core/llm-protocol';
import {ABORT_KEY, AbortError, AbortScopeFactory} from '@novel-master/core/abort';
import {AppError, AppErrorOps} from '@novel-master/core/errors';
import {Result} from '@novel-master/core/errors';
import {CloudSyncSdkErrorMapper} from './map-cloud-sync-sdk-error';
import {CloudSyncProgressLog} from './cloud-sync-progress-log';
import type {CloudSyncProgressListener} from './cloud-sync-progress-ui';
import {S3ObjectStorage} from '@novel-master/cloud-sync-driver-s3';
import {HeadBucketCommand, ListObjectsV2Command} from '@aws-sdk/client-s3';
import {AwsRnS3Client} from '@/shims/aws-rn-s3-client';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {Buffer} from 'buffer';
import type {S3StorageConfig} from '@novel-master/cloud-sync-driver-s3';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {agentActivity} from '@/runtime/agent-activity';
import {DbBackupService} from './db-backup.service';
import {maintenanceBusy} from './db-maintenance-busy';
import {SnapshotFileHash} from './snapshot-file-hash';
import {CloudSyncConfigStore, type CloudSyncConfigInput, type CloudSyncLocalStatus} from './cloud-sync-config.store';

type CloudSyncStatusView = CloudSyncLocalStatus & {
  remoteRev: number;
  suggestPull: boolean;
};

type CloudSyncPullOutcome = {
  rev: number;
  alreadyUpToDate: boolean;
};

type CloudSyncPushOptions = {
  forceOverwriteRemote?: boolean;
  /** 同步阶段进度，供 UI 遮罩/进度条使用 */
  onProgress?: CloudSyncProgressListener;
};

type CloudSyncPullOptions = {
  onProgress?: CloudSyncProgressListener;
};

export type {CloudSyncProgressListener, CloudSyncProgressUiState} from './cloud-sync-progress-ui';

type Utf8Decoder = {decode: (input: Uint8Array) => string};
type Utf8DecoderCtor = new () => Utf8Decoder;
type Rebootstrap = () => Promise<MobileNovelMasterRuntime>;
type CloudSyncProgress = ReturnType<typeof CloudSyncProgressLog.create>;
type CoordinatorBundle = {
  coordinator: CloudSyncCoordinator;
  pathPrefix: string;
  exportTempPath: string;
  importTempPath: string;
};

let syncBusy = false;

export namespace CloudSyncService {
  async function readFileBytes(path: string): Promise<Uint8Array> {
    const base64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  async function getFileSize(path: string): Promise<number> {
    const stat = await ReactNativeBlobUtil.fs.stat(path);
    return Number(stat.size);
  }

  // nm-style: keep-local — 独立 IO 管线（配置解析 → S3 head/get → status 解析）；调用方以 Result 收敛为边界统一按 0 收。
  async function readRemoteRev(runtime: MobileNovelMasterRuntime, s3Config?: S3StorageConfig): Promise<Result<number, AppError>> {
    const configResult = s3Config != null ? Result.ok(s3Config) : await CloudSyncConfigStore.buildS3StorageConfig(runtime);
    if (!configResult.ok) return Result.err(configResult.error);
    const config = configResult.value;
    const storage = S3ObjectStorage.create(config, {
      client: AwsRnS3Client.create(config),
    });
    const publicConfig = await CloudSyncConfigStore.get(runtime);
    if (!publicConfig.ok) return Result.err(publicConfig.error);
    const key = CloudSyncPaths.statusKey(publicConfig.value.pathPrefix);
    const head = await storage.head(key);
    if (!head.exists) {
      return Result.ok(0);
    }
    const {body} = await storage.get(key);
    try {
      const Decoder = (globalThis as {TextDecoder?: Utf8DecoderCtor}).TextDecoder;
      let text = '';
      if (typeof Decoder === 'function') {
        text = new Decoder().decode(body);
      } else {
        for (let i = 0; i < body.length; i++) {
          text += String.fromCharCode(body[i]!);
        }
      }
      const parsedStatus = CloudSyncStatusParser.parse(JSON.parse(text));
      if (!parsedStatus.ok) return Result.err(parsedStatus.error);
      return Result.ok(parsedStatus.value.rev);
    } catch (error) {
      return Result.err(new AppError('CLOUD_SYNC_INVALID_STATUS', {detail: '云端状态文件无法解析'}, {cause: error}));
    }
  }

  async function createCoordinator(runtime: MobileNovelMasterRuntime, s3Config?: S3StorageConfig, progress?: CloudSyncProgress): Promise<Result<CoordinatorBundle, AppError>> {
    const publicConfig = await CloudSyncConfigStore.get(runtime);
    if (!publicConfig.ok) return Result.err(publicConfig.error);
    const storageConfigResult = s3Config != null ? Result.ok(s3Config) : await CloudSyncConfigStore.buildS3StorageConfig(runtime);
    if (!storageConfigResult.ok) return Result.err(storageConfigResult.error);
    const storageConfig = storageConfigResult.value;
    const baseStorage = S3ObjectStorage.create(storageConfig, {
      client: AwsRnS3Client.create(storageConfig),
      // mobile 端注入基于 react-native-blob-util 的 FileSystemPort（对应 A-26）。
      fileSystem: {
        readFile: readFileBytes,
        writeFile: async (path, bytes) => {
          await ReactNativeBlobUtil.fs.writeFile(path, Buffer.from(bytes).toString('base64'), 'base64');
        },
      },
    });
    const storage = progress != null ? CloudSyncProgressLog.withStorageProgress(baseStorage, progress) : baseStorage;
    const pathPrefix = Path.ensureTrailingSlash(publicConfig.value.pathPrefix);
    const stamp = Date.now();
    const exportTempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/cloud-sync-export-${stamp}.nmbackup`;
    const importTempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/cloud-sync-import-${stamp}.nmbackup`;

    const coordinator = new CloudSyncCoordinator({
      storage,
      pathPrefix,
      deviceId: publicConfig.value.deviceId,
      exportTempPath,
      importTempPath,
      computeSha256Hex: bytes => {
        progress?.step('sha256_start', {bytes: bytes.byteLength});
        const hashStart = Date.now();
        const hash = SnapshotFileHash.sha256Hex(bytes);
        progress?.step('sha256_done', {ms: Date.now() - hashStart});
        return hash;
      },
      hashSnapshotFile: async path => {
        progress?.step('sha256_file_start', {});
        const hashStart = Date.now();
        const hash = await SnapshotFileHash.hashFile(path);
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
      // busy 互斥由底层 exportToPath / importFromPath
      // 系列内部的 acquire/release 计数配对覆盖——快照导出与「关连接 +
      // 覆盖库文件」窗口期间归一/压缩后台循环让路；pull 侧 rebootstrap
      // 之后的重建窗口由 pull 的外层 acquire/release 兜住。
      dbSync: {
        isAgentActive: () => agentActivity.isActive(),
        exportSnapshotToPath: async dest => {
          progress?.step('db_export_start', {});
          const exportStart = Date.now();
          await DbBackupService.exportToPath(runtime, dest);
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
          // databaseReplaced === undefined ⇒ pull 永不重建 runtime ⇒
          // 后续所有记账/读写绑在已关连接上。
          const imported = await DbBackupService.importFromBytes(bytes);
          // 已知失败沿 Result 回传（DbSyncPort 已转 Result 通道）：coordinator
          // 据此短路 pull；DatabaseReplacedError 这类抛错路径自然向上传播。
          if (!imported.ok) return imported;
          progress?.step('db_import_done', {ms: Date.now() - importStart});
          return Result.ok(imported.value);
        },
        importSnapshotFromPath: async path => {
          progress?.step('db_import_start', {fromPath: true});
          const importStart = Date.now();
          const imported = await DbBackupService.importFromPath(path);
          // 同 importSnapshot：Result 回传失败位。
          if (!imported.ok) return imported;
          progress?.step('db_import_done', {ms: Date.now() - importStart});
          return Result.ok(imported.value);
        },
      },
    });

    return Result.ok({coordinator, pathPrefix, exportTempPath, importTempPath});
  }

  /** 读取本机状态与云端 rev，供 Profile 展示。已知失败沿 `Result.err` 上行；云端 rev 读不到按缺省 0 收（旧 catch 同路径）。 */
  // nm-style: keep-public — cloud-sync-storage-screen-source.test.ts 以源码正则锁名；config 集成测试直接调用
  export async function getStatusView(runtime: MobileNovelMasterRuntime): Promise<Result<CloudSyncStatusView, AppError>> {
    const local = await CloudSyncConfigStore.getLocalStatus(runtime);
    if (!local.ok) return Result.err(local.error);
    if (!local.value.configured) {
      return Result.ok({...local.value, remoteRev: 0, suggestPull: false});
    }
    try {
      const remote = await readRemoteRev(runtime);
      const remoteRev = remote.ok ? remote.value : 0;
      return Result.ok({
        ...local.value,
        remoteRev,
        suggestPull: remoteRev > local.value.lastSyncedRev,
      });
    } catch {
      return Result.ok({...local.value, remoteRev: 0, suggestPull: false});
    }
  }

  /** 测试 S3 连接（HeadBucket 或 ListObjectsV2，不读写 status.json）。配置类失败沿 `Result.err` 上行，存储侧故障保持异常（屏幕 catch 提示）。 */
  // nm-style: keep-public — cloud-sync.service.test.ts describe('testCloudSyncConnection') 直接 import 断言，测试锁名
  export async function testConnection(runtime: MobileNovelMasterRuntime, input?: CloudSyncConfigInput): Promise<Result<void, AppError>> {
    const s3Config = await CloudSyncConfigStore.buildS3StorageConfig(runtime, input);
    if (!s3Config.ok) return Result.err(s3Config.error);
    const client = AwsRnS3Client.create(s3Config.value);
    const publicConfig = await CloudSyncConfigStore.get(runtime);
    if (!publicConfig.ok) return Result.err(publicConfig.error);
    const pathPrefix = Path.ensureTrailingSlash(input?.pathPrefix?.trim() || publicConfig.value.pathPrefix);

    const progress = CloudSyncProgressLog.create('test');
    progress.step('start', {bucket: s3Config.value.bucket, prefix: pathPrefix});

    try {
      progress.step('head_bucket_start', {});
      await client.send(new HeadBucketCommand({Bucket: s3Config.value.bucket}));
      progress.done({via: 'HeadBucket'});
    } catch (headError) {
      progress.step('head_bucket_failed', {
        error: headError instanceof Error ? headError.message : String(headError),
      });
      try {
        progress.step('list_objects_start', {});
        await client.send(new ListObjectsV2Command({Bucket: s3Config.value.bucket, Prefix: pathPrefix, MaxKeys: 1}));
        progress.done({via: 'ListObjectsV2'});
      } catch (listError) {
        progress.fail(listError ?? headError);
        throw CloudSyncSdkErrorMapper.map(listError ?? headError);
      }
    }
    return Result.ok(undefined);
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
   * mobile 对齐同一口径。检查与置位必须落在 `maintenanceBusy.acquire()`
   * 之前或已建立的 `try` 内——落在两者之间（try 之外）会原样复现令牌泄漏形态。
   */

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
  // nm-style: keep-public — cloud-sync.service.test.ts describe('pullCloudSync') 多用例直接 import；progress-cancel 测试经它驱动
  export async function pull(runtime: MobileNovelMasterRuntime, onRebootstrap: Rebootstrap, options?: CloudSyncPullOptions): Promise<Result<CloudSyncPullOutcome, AppError>> {
    const local = await CloudSyncConfigStore.getLocalStatus(runtime);
    if (!local.ok) return Result.err(local.error);
    if (!local.value.configured) {
      return Result.err(new AppError('CLOUD_SYNC_NOT_CONFIGURED', {detail: '请先配置云存储'}));
    }

    if (syncBusy) {
      return Result.err(new AppError('AGENT_BUSY', {detail: '云同步进行中，请稍后再试'}));
    }
    syncBusy = true;
    // 任务级取消作用域：key 固定 `sync:local`（S3 配置无 provider 概念，
    // syncBusy 全局互斥）。pull/push 各自建 scope 并登记，finally 反注册 + dispose。
    const abortScope = AbortScopeFactory.create();
    runtime.abortRegistry.register(ABORT_KEY.cloudSync('local'), abortScope);

    // 外层 acquire（计数/令牌配对）：底层导入函数的 acquire/release 只
    // 覆盖到它自己返回，「库文件已替换、连接仍处重建窗口」的尾段由这层
    // 兜住——release 必须发生在重建 + 记账完成之后（含重建窗口的
    // 完整互斥），其余出口（错误 / already-up-to-date）由 finally 兜底，
    // 令牌标记保证幂等不重复 release。
    maintenanceBusy.acquire();
    let pullBusyHeld = true;
    const releasePullBusy = (): void => {
      if (pullBusyHeld) {
        pullBusyHeld = false;
        maintenanceBusy.release();
      }
    };

    // progress / coordinator / 临时路径都先声明再赋值：CloudSyncProgressLog.create
    // 与 createCoordinator 都在 try 内，但 catch 里要引用 progress（需 ?.），
    // finally 里要引用临时路径（需 != null 守卫）——不提升就会 TDZ，
    // 或让 `unlink(undefined)` 用一个新错盖掉原始错。
    let progress: ReturnType<typeof CloudSyncProgressLog.create> | undefined;
    let coordinator: CloudSyncCoordinator;
    let exportTempPath: string | undefined;
    let importTempPath: string | undefined;
    // catch 分支要用它记账，必须声明在 try 之外。
    const now = new Date().toISOString();
    // 记账用的 runtime：pull 未换代时是传入的 runtime，换代成功后换成重建出来的新
    // runtime。catch 分支同样只能用它，绝不写回已作废的那一代。
    let accountingRuntime: MobileNovelMasterRuntime = runtime;

    try {
      progress = CloudSyncProgressLog.create('pull', {
        onUiProgress: options?.onProgress,
      });
      progress.step('start', {lastSyncedRev: local.value.lastSyncedRev});
      // 入口检查点：登记之后、进入协调器之前（UI 取消与启动的竞态窗口）。
      if (abortScope.checkpoint() != null) throw AbortError.create();
      const created = await createCoordinator(runtime, undefined, progress);
      if (!created.ok) return Result.err(created.error);
      coordinator = created.value.coordinator;
      exportTempPath = created.value.exportTempPath;
      importTempPath = created.value.importTempPath;

      progress.step('coordinator_pull_start', {});
      const pulled = await coordinator.pull({lastSyncedRev: local.value.lastSyncedRev, checkpoint: () => abortScope.checkpoint()});
      if (!pulled.ok) {
        if (AppErrorOps.is(pulled.error, 'CLOUD_SYNC_ALREADY_UP_TO_DATE')) {
          // ⚠️ `.catch(() => undefined)` 是**有意补的对称**（CR cloudsync P2-3）：
          // 本行在失败分支内部，记账一旦抛错会**从分支里再抛**出去 ⇒ 直接跳过
          // 下面的 `progress?.done`，把「已是最新」这个正常语义换成一个裸错误
          // 往上冒。该分支确实不换代（runtime 是活的），但「抛错概率低」不等于
          // 「不抛」——账本写盘撞上库忙/锁冲突一样会失败。
          // 记账是旁路，让它失败，不要拿它污染主语义。
          await CloudSyncConfigStore.patchLocalStatus(runtime, {
            lastPullAt: now,
            lastPullResult: 'already_up_to_date',
          }).catch(() => undefined);
          progress?.done({rev: local.value.lastSyncedRev, alreadyUpToDate: true});
          return Result.ok({rev: local.value.lastSyncedRev, alreadyUpToDate: true});
        }
        // 业务失败（快照缺失 / 校验和不符 / agent 在跑等）都发生在换库之前，
        // 用 accountingRuntime（此刻仍等于传入 runtime）记账即可。
        await CloudSyncConfigStore.patchLocalStatus(accountingRuntime, {
          lastPullAt: now,
          lastPullResult: 'error',
        }).catch(() => undefined);
        progress?.fail(pulled.error);
        return Result.err(pulled.error);
      }
      const result = pulled.value;
      if (result.databaseReplaced) {
        // 先重建，再用新 runtime 记账。
        accountingRuntime = await onRebootstrap();
        await CloudSyncConfigStore.patchLocalStatus(accountingRuntime, {
          lastSyncedRev: result.rev,
          lastPullAt: now,
          lastPullResult: 'success',
        });
      } else {
        // 这条分支不换代（库没换、连接没关），所以记账可以用旧 runtime。
        await CloudSyncConfigStore.patchLocalStatus(runtime, {
          lastPullAt: now,
          lastPullResult: 'already_up_to_date',
        });
      }
      // 重建 + 记账已完成，重建窗口结束，此处释放外层互斥（finally 兜底幂等）。
      releasePullBusy();
      progress.done({rev: result.rev});
      return Result.ok({rev: result.rev, alreadyUpToDate: false});
    } catch (error) {
      if (RequestAbort.isAbortLikeError(error)) {
        // 取消不是错误：账本记 cancelled（不记 error）、进度走取消终态，
        // AbortError 原样上抛——绝不能进 mapCloudSyncSdkError 被包成 NETWORK。
        await CloudSyncConfigStore.patchLocalStatus(accountingRuntime, {
          lastPullAt: now,
          lastPullResult: 'cancelled',
        }).catch(() => undefined);
        progress?.step('pull_cancelled', {reason: abortScope.reason ?? undefined});
        throw error;
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
      await CloudSyncConfigStore.patchLocalStatus(accountingRuntime, {
        lastPullAt: now,
        lastPullResult: 'error',
      }).catch(() => undefined);
      progress?.fail(error);
      return Result.err(CloudSyncSdkErrorMapper.map(error));
    } finally {
      syncBusy = false;
      runtime.abortRegistry.unregister(ABORT_KEY.cloudSync('local'), abortScope);
      abortScope.dispose();
      releasePullBusy();
      if (exportTempPath != null) {
        await ReactNativeBlobUtil.fs.unlink(exportTempPath).catch(() => undefined);
      }
      if (importTempPath != null) {
        await ReactNativeBlobUtil.fs.unlink(importTempPath).catch(() => undefined);
      }
    }
  }

  /** 推送本机快照到云端（不触发 rebootstrap）。 */
  // nm-style: keep-public — cloud-sync.service.test.ts / cloud-sync-progress-screen-cancel.test.tsx 直接 import 断言，测试锁名
  export async function push(runtime: MobileNovelMasterRuntime, options: CloudSyncPushOptions | undefined): Promise<Result<{rev: number}, AppError>> {
    const local = await CloudSyncConfigStore.getLocalStatus(runtime);
    if (!local.ok) return Result.err(local.error);
    if (!local.value.configured) {
      return Result.err(new AppError('CLOUD_SYNC_NOT_CONFIGURED', {detail: '请先配置云存储'}));
    }

    if (syncBusy) {
      return Result.err(new AppError('AGENT_BUSY', {detail: '云同步进行中，请稍后再试'}));
    }
    syncBusy = true;
    // 任务级取消作用域：与 pull 共用 `sync:local`（syncBusy 全局互斥，同一时刻
    // 只有一个云同步任务在册）。
    const abortScope = AbortScopeFactory.create();
    runtime.abortRegistry.register(ABORT_KEY.cloudSync('local'), abortScope);

    const progress = CloudSyncProgressLog.create('push', {
      onUiProgress: options?.onProgress,
    });
    progress.step('start', {
      lastSyncedRev: local.value.lastSyncedRev,
      forceOverwriteRemote: options?.forceOverwriteRemote ?? false,
    });

    const now = new Date().toISOString();
    try {
      // 入口检查点：登记之后、进入协调器之前（UI 取消与启动的竞态窗口）。
      if (abortScope.checkpoint() != null) throw AbortError.create();
      const created = await createCoordinator(runtime, undefined, progress);
      if (!created.ok) {
        progress.fail(created.error);
        return Result.err(created.error);
      }
      const {coordinator, exportTempPath} = created.value;

      try {
        progress.step('coordinator_push_start', {});
        const pushed = await coordinator.push({lastSyncedRev: local.value.lastSyncedRev, forceOverwriteRemote: options?.forceOverwriteRemote, checkpoint: () => abortScope.checkpoint()});
        if (!pushed.ok) {
          // 业务失败（需先拉取 / 锁被他人持有 / 互斥超时等）：与 catch 的未知
          // 异常通道分开，沿 Result.err 上行，屏幕按 NEED_PULL_FIRST 分流转。
          await CloudSyncConfigStore.patchLocalStatus(runtime, {
            lastPushAt: now,
            lastPushResult: 'error',
          });
          progress.fail(pushed.error);
          return Result.err(pushed.error);
        }
        const result = pushed.value;
        await CloudSyncConfigStore.patchLocalStatus(runtime, {
          lastSyncedRev: result.rev,
          lastPushAt: now,
          lastPushResult: 'success',
        });
        progress.done({rev: result.rev});
        return Result.ok(result);
      } catch (error) {
        if (RequestAbort.isAbortLikeError(error)) {
          // 取消不在这里记账：交给外层 catch 统一收口（入口取消与协调器阶段
          // 边界取消走同一条），且绝不能被下面的 mapCloudSyncSdkError 包成 NETWORK。
          throw error;
        }
        await CloudSyncConfigStore.patchLocalStatus(runtime, {
          lastPushAt: now,
          lastPushResult: 'error',
        });
        progress.fail(error);
        throw CloudSyncSdkErrorMapper.map(error);
      } finally {
        if (exportTempPath != null) {
          await ReactNativeBlobUtil.fs.unlink(exportTempPath).catch(() => undefined);
        }
      }
    } catch (error) {
      if (RequestAbort.isAbortLikeError(error)) {
        // 取消不是错误：账本记 cancelled（不记 error）、进度走取消终态，
        // AbortError 原样上抛（不得被 mapCloudSyncSdkError 包成 NETWORK）。
        await CloudSyncConfigStore.patchLocalStatus(runtime, {
          lastPushAt: now,
          lastPushResult: 'cancelled',
        }).catch(() => undefined);
        progress.step('push_cancelled', {reason: abortScope.reason ?? undefined});
      }
      throw error;
    } finally {
      syncBusy = false;
      runtime.abortRegistry.unregister(ABORT_KEY.cloudSync('local'), abortScope);
      abortScope.dispose();
    }
  }
}

export type {CloudSyncConfigInput, CloudSyncLocalStatus} from './cloud-sync-config.store';
