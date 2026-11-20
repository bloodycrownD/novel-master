/**
 * Desktop 云同步服务：组装 CloudSyncCoordinator、S3 驱动与 DbSyncPort。
 *
 * @module services/cloud-sync.service
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudSyncCoordinator, CloudSyncPaths, CloudSyncStatusParser, DatabaseReplacedError, type CloudSyncConfigInput, type ObjectStoragePort } from "@novel-master/core";
import { AppError, AppErrorOps, ErrorGuards, Result, type Interrupt } from "@novel-master/core/errors";
import { S3ObjectStorage } from "@novel-master/cloud-sync-driver-s3";
import type { S3StorageConfig } from "@novel-master/cloud-sync-driver-s3";
import { HeadBucketCommand, ListObjectsV2Command, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { Concurrency, Path } from "@novel-master/core/common";
import { agentActivity } from "../runtime/agent-activity.js";
import { maintenanceBusy } from "./db-maintenance-busy.js";
import { CloudSyncConfigStore, type CloudSyncConfigDto, type CloudSyncLocalMeta } from "./cloud-sync-config.store.js";

export type CloudSyncLocalStatusDto = {
  configured: boolean;
  deviceId?: string;
  deviceLabel?: string;
  lastSyncedRev: number;
  remoteRev?: number;
  lastPullAt?: string;
  lastPushAt?: string;
  lastPullResult?: string;
  lastPushResult?: string;
  suggestsPull: boolean;
  syncBusy: boolean;
  agentActive: boolean;
  /** 数据清理（VACUUM）进行中：期间禁用同步操作。 */
  maintenanceBusy: boolean;
};

/**
 * 云同步执行窗口（pull/push 互斥；计数实现与 db-maintenance-busy 同源）。
 * 单实例计数与旧布尔等价：`if (syncBusy.isBusy())` 守卫保证不会嵌套 acquire。
 */
/** 云同步（pull/push）是否进行中：供数据清理等数据库操作的入口守卫使用。 */
export const syncBusy: ReturnType<typeof Concurrency.createBusyFlag> = Concurrency.createBusyFlag();

class DesktopCloudSyncService {
  /**
   * 构造时传入的 runtime 对象本身。
   *
   * 单例按 runtime 身份换代：rebootstrap 产生的是**新 runtime 对象**
   * （desktop-runtime-singleton 每次重建都 new 出来），身份比较天然成立，
   * 无需任何调用点配合——本地备份导入（handlers/backup.ts）那条 rebootstrap
   * 路径因此也被自动覆盖。service 整体按代重建后 `this.runtime` 恒为当代
   * runtime，故不另设 `currentRuntime()` 访问器（避免「读哪一份」二义）。
   */
  private readonly runtimeIdentity: object;
  private readonly runtime: DesktopNovelMasterRuntime;
  private readonly configStore: CloudSyncConfigStore;

  constructor(runtime: DesktopNovelMasterRuntime) {
    this.runtime = runtime;
    this.runtimeIdentity = runtime;
    this.configStore = CloudSyncConfigStore.create(runtime.kkv, runtime.secretStore);
  }

  async getConfig(): Promise<Result<CloudSyncConfigDto, AppError>> {
    return this.configStore.getConfig();
  }

  /**
   * 本实例是否属于该 runtime 那一代（单例按身份换代用）。
   *
   * nm-style: keep-public — 类外单例换代判定入口；比较对象是 private runtimeIdentity，
   * 内联需把身份字段暴露给调用方，破坏「按代重建」不变量。
   */
  isForRuntime(runtime: DesktopNovelMasterRuntime): boolean {
    return this.runtimeIdentity === runtime;
  }

  async setConfig(input: CloudSyncConfigInput): Promise<Result<void, AppError>> {
    return this.configStore.setConfig(input);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.configStore.setEnabled(enabled);
  }

  /** nm-style: keep-public — IPC handler 的云连接测试入口；S3 客户端构造与 mapStorageError 属 service 的 IO/错误策略，handler 不持有。 */
  async testConnection(): Promise<Result<void, AppError>> {
    const publicConfig = await this.configStore.getPublicConfig();
    if (!publicConfig.ok) return Result.err(publicConfig.error);
    const secret = await this.configStore.getSecretAccessKey();
    if (secret == null || secret.length === 0) return Result.err(new AppError("CLOUD_SYNC_NOT_CONFIGURED", { detail: "请先配置云存储" }));
    const s3Config: S3StorageConfig = {
      endpoint: publicConfig.value.endpoint,
      region: publicConfig.value.region,
      bucket: publicConfig.value.bucket,
      accessKeyId: publicConfig.value.accessKeyId,
      secretAccessKey: secret,
      forcePathStyle: publicConfig.value.forcePathStyle,
    };
    const clientConfig: S3ClientConfig = {
      region: s3Config.region || "us-east-1",
      endpoint: s3Config.endpoint,
      credentials: { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey },
      forcePathStyle: s3Config.forcePathStyle ?? false,
    };
    const client = new S3Client(clientConfig);
    const pathPrefix = Path.ensureTrailingSlash(publicConfig.value.pathPrefix);

    try {
      await client.send(new HeadBucketCommand({ Bucket: s3Config.bucket }));
    } catch (headError) {
      try {
        await client.send(new ListObjectsV2Command({ Bucket: s3Config.bucket, Prefix: pathPrefix, MaxKeys: 1 }));
      } catch (listError) {
        // 存储侧故障（未知通道，core CloudSyncError 体系）原样抛给 handler catch；
        // 错误映射内联自原 mapStorageError。
        const error = listError ?? headError;
        if (AppErrorOps.is(error) && ErrorGuards.domainOf(error.code) === "CLOUD_SYNC") throw error;
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        if (lower.includes("access denied") || lower.includes("invalidaccesskeyid") || lower.includes("signaturedoesnotmatch") || lower.includes("403")) {
          return Result.err(new AppError("CLOUD_SYNC_AUTH", { detail: "云存储凭据无效或权限不足" }, { cause: error }));
        }
        if (lower.includes("network") || lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("enotfound")) {
          return Result.err(new AppError("CLOUD_SYNC_NETWORK", { detail: "无法连接云存储，请检查网络与 Endpoint" }, { cause: error }));
        }
        return Result.err(new AppError("CLOUD_SYNC_NETWORK", { detail: message }, { cause: error }));
      }
    }
    return Result.ok(undefined);
  }
  /** nm-style: keep-public — IPC handler 的状态聚合入口；聚合 configStore/secret/agentActive/maintenanceBusy 多处状态，handler 不持有这些依赖。 */
  async getLocalStatus(): Promise<Result<CloudSyncLocalStatusDto, AppError>> {
    const config = await this.configStore.getConfig();
    if (!config.ok) return Result.err(config.error);
    const meta = await this.configStore.getLocalMeta();
    if (!meta.ok) return Result.err(meta.error);
    const secret = await this.configStore.getSecretAccessKey();
    const cfg = config.value;
    const hasSecret = secret != null && secret.length > 0;
    const configured = cfg.enabled && cfg.endpoint.trim().length > 0 && cfg.bucket.trim().length > 0 && cfg.accessKeyId.trim().length > 0 && cfg.deviceId.trim().length > 0 && hasSecret;
    const agentActive = agentActivity.isActive();

    let remoteRev: number | undefined;
    if (configured) {
      try {
        // 已知失败与旧 throw→catch 同路径收成 undefined（错误通道迁移四期）；
        // 读取链路（storage → head → get → 解析）内联自原 readRemoteRev/buildStorage。
        const publicConfig = await this.configStore.getPublicConfig();
        if (publicConfig.ok) {
          const storageSecret = await this.configStore.getSecretAccessKey();
          if (storageSecret != null && storageSecret.length > 0) {
            const storageConfig: S3StorageConfig = {
              endpoint: publicConfig.value.endpoint,
              region: publicConfig.value.region,
              bucket: publicConfig.value.bucket,
              accessKeyId: publicConfig.value.accessKeyId,
              secretAccessKey: storageSecret,
              forcePathStyle: publicConfig.value.forcePathStyle,
            };
            const storage = S3ObjectStorage.create(storageConfig);
            const key = CloudSyncPaths.statusKey(publicConfig.value.pathPrefix);
            const head = await storage.head(key);
            if (!head.exists) {
              remoteRev = 0;
            } else {
              const { body } = await storage.get(key);
              const parsed = JSON.parse(new TextDecoder().decode(body));
              const status = CloudSyncStatusParser.parse(parsed);
              remoteRev = status.ok ? status.value.rev : 0;
            }
          }
        }
      } catch {
        remoteRev = undefined;
      }
    }

    const lastSyncedRev = meta.value.lastSyncedRev;
    const suggestsPull = remoteRev != null && remoteRev > lastSyncedRev;

    return Result.ok({
      configured,
      deviceId: config.value.deviceId || undefined,
      deviceLabel: config.value.deviceLabel || undefined,
      lastSyncedRev,
      remoteRev,
      lastPullAt: meta.value.lastPullAt || undefined,
      lastPushAt: meta.value.lastPushAt || undefined,
      lastPullResult: meta.value.lastPullResult || undefined,
      lastPushResult: meta.value.lastPushResult || undefined,
      suggestsPull,
      syncBusy: syncBusy.isBusy(),
      agentActive,
      maintenanceBusy: maintenanceBusy.isBusy(),
    });
  }

  /**
   * 拉取并导入远端快照。
   *
   * 契约顺序：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
   * 本方法只做「换库」并回报 `databaseReplaced`；**换代成功时不在此处记账**
   * ——此刻 `this.configStore` 背后的连接刚被 `importDatabaseBackupFrom*` 关掉，
   * 记账会抛 `CONNECTION_CLOSED`（且抛错发生在 recordPull 之前，把已完成的
   * 拉取记成失败，rev 永不推进）。记账改由 handler 在
   * `DesktopRuntimeSingleton.rebootstrap()` 之后调 {@link recordPullSuccess} 完成。
   *
   * `ALREADY_UP_TO_DATE` 早返回分支与失败分支仍在本处记账：**库没换、连接没关**，
   * 此时旧 runtime 仍是活的，记账句柄有效。该早返回对象的
   * `databaseReplaced` 恒为 `false`。
   */
  async pull(options?: { readonly checkpoint?: () => Interrupt | null }): Promise<Result<{ rev: number; databaseReplaced: boolean }, AppError>> {
    if (syncBusy.isBusy()) {
      return Result.err(new AppError("CLI_INVALID_ARGUMENT", { detail: "云同步进行中，请稍后再试" }));
    }
    syncBusy.acquire();
    let meta: CloudSyncLocalMeta | undefined;
    let exportTempPath: string | undefined;
    let importTempPath: string | undefined;
    try {
      // getLocalMeta 的读取必须紧跟置位（对齐 push() 写法）：已知失败走下面的
      // 内联记账分支（与旧 catch 失败分支同款），syncBusy 由 finally 复位。
      const metaResult = await this.configStore.getLocalMeta();
      if (!metaResult.ok) {
        // KKV 读失败（已知，错误通道迁移四期沿 Result 上行）：此刻不可能发生
        // 换库（coordinator 尚未运行），与旧 catch 的非换代分支同款记账。
        await this.configStore.recordPull(false, metaResult.error.message).catch(() => undefined);
        return Result.err(metaResult.error);
      }
      meta = metaResult.value;
      const built = await this.buildCoordinator(storageOverrideForTest);
      if (!built.ok) {
        await this.configStore.recordPull(false, built.error.message).catch(() => undefined);
        return Result.err(built.error);
      }
      exportTempPath = built.value.exportTempPath;
      importTempPath = built.value.importTempPath;
      const pulled = await built.value.coordinator.pull({ lastSyncedRev: meta.lastSyncedRev, ...(options?.checkpoint != null ? { checkpoint: options.checkpoint } : {}) });
      // 错误通道迁移五期：coordinator.pull 沿 Result 回传已知失败。ALREADY_UP_TO_DATE
      // 走下方 catch 分支的同款记账（「已是最新」+ 不换代）；其余 Err 原样上抛给
      // handler 的 catch（formatIpcError 收口），不重复记账。
      if (!pulled.ok) {
        if (AppErrorOps.is(pulled.error, "CLOUD_SYNC_ALREADY_UP_TO_DATE")) {
          await this.configStore.recordPull(true, "已是最新");
          return Result.ok({ rev: meta?.lastSyncedRev ?? 0, databaseReplaced: false });
        }
        // 已知失败就地补记账后沿 Result 上行（错误通道迁移七期，与旧 catch 的
        // 非换代分支同款）；换代失败不经本支——DatabaseReplacedError 仍由
        // throw 通道抵达下方 catch（DatabaseReplacedError 判定跳过记账）。
        await this.configStore.recordPull(false, pulled.error.message).catch(() => undefined);
        return Result.err(pulled.error);
      }
      return Result.ok(pulled.value);
    } catch (error) {
      if (AppErrorOps.is(error, "CLOUD_SYNC_ALREADY_UP_TO_DATE")) {
        // 兼容 coordinator 侧仍走 throw 通道的路径：此时 meta 必已赋值。
        await this.configStore.recordPull(true, "已是最新");
        return Result.ok({ rev: meta?.lastSyncedRev ?? 0, databaseReplaced: false });
      }
      const detail = error instanceof Error ? error.message : String(error);
      // ⚠️ `DatabaseReplacedError` 这一支**不做 recordPull**（CR cloudsync P2-1）。
      // 此刻 `closeLiveDbForBackupImport()` 已经把 `this.configStore` 背后的连接
      // 关掉了 ⇒ `recordPull` 必抛 `CONNECTION_CLOSED` ⇒ 被下面的 `.catch` 吃掉
      // ⇒ 面板上「上次拉取结果」永远停在旧值，与实际发生的「换代成功但三表未恢复」
      // 永久不一致。**一次注定失败的写还不如不写**：它既不产生任何信息，还制造
      // 一次「以为自己记过了」的错觉。
      // 换代路径的记账由 handler 在 `DesktopRuntimeSingleton.rebootstrap()` 之后走
      // `recordPullSuccess()` 现场造 store 来做（见该方法 JSDoc），不依赖本支。
      if (!(error instanceof DatabaseReplacedError)) {
        await this.configStore.recordPull(false, detail).catch(() => undefined);
      }
      // coordinator 侧故障（core CloudSyncError 体系，三期保留 throw 协议）与
      // 未知的运行期异常：沿未知通道抛给 handler catch（错误通道迁移四期不动）。
      throw error;
    } finally {
      syncBusy.release();
      if (exportTempPath != null) {
        await unlink(exportTempPath).catch(() => undefined);
      }
      if (importTempPath != null) {
        await unlink(importTempPath).catch(() => undefined);
      }
    }
  }

  /**
   * 换代之后记账 pull 成功：每次现取 runtime 现场构造 config store。
   *
   * 必须现取：handler 在 `DesktopRuntimeSingleton.rebootstrap()` **之前**捕获的 service
   * 仍是旧代实例，其 `configStore` 绑的是已被关掉的连接——按身份重建救不了
   * 旧实例上的方法调用。`DesktopRuntimeSingleton.get()` 在 `closeLiveDbForBackupImport`
   * 之后会懒建出一个**新对象**，这里的 store 因此必然绑在活连接上。
   *
   * nm-style: keep-public — rebootstrap 后由 handler 调用的记账交接点；需在方法内现取新 runtime
   * 现场构造 store（见上方契约），handler 复制该逻辑只会多一份漂移点。
   */
  async recordPullSuccess(rev: number): Promise<void> {
    const { DesktopRuntimeSingleton } = await import("../runtime/desktop-runtime-singleton.js");
    // 调用契约：handler 在 `DesktopRuntimeSingleton.rebootstrap()` 成功之后才进本方法，
    // 单例 runtime 字段必已就位（换库懒建已发生），同步取即可。
    const rt = DesktopRuntimeSingleton.getOrThrow();
    const store = CloudSyncConfigStore.create(rt.kkv, rt.secretStore);
    await store.setLastSyncedRev(rev);
    await store.recordPull(true, `已同步至 rev ${rev}`);
  }

  async push(options?: { forceOverwriteRemote?: boolean; readonly checkpoint?: () => Interrupt | null }): Promise<Result<{ rev: number }, AppError>> {
    if (syncBusy.isBusy()) {
      return Result.err(new AppError("CLI_INVALID_ARGUMENT", { detail: "云同步进行中，请稍后再试" }));
    }
    syncBusy.acquire();
    let exportTempPath: string | undefined;
    let importTempPath: string | undefined;
    try {
      const built = await this.buildCoordinator();
      if (!built.ok) {
        // 未配置等已知失败：与旧 catch 失败分支同款记账后沿 Result 上行
        // （错误通道迁移四期）。
        await this.configStore.recordPush(false, built.error.message).catch(() => undefined);
        return Result.err(built.error);
      }
      exportTempPath = built.value.exportTempPath;
      importTempPath = built.value.importTempPath;
      const meta = await this.configStore.getLocalMeta();
      if (!meta.ok) {
        await this.configStore.recordPush(false, meta.error.message).catch(() => undefined);
        return Result.err(meta.error);
      }
      const pushed = await built.value.coordinator.push({ lastSyncedRev: meta.value.lastSyncedRev, forceOverwriteRemote: options?.forceOverwriteRemote, ...(options?.checkpoint != null ? { checkpoint: options.checkpoint } : {}) });
      // 已知失败（NEED_PULL_FIRST / LOCK_HELD_BY_OTHER 等）就地补记账后沿
      // Result 上行（错误通道迁移七期，与旧 catch 失败分支同款）；coordinator
      // 侧未知故障仍走 throw 通道。
      if (!pushed.ok) {
        await this.configStore.recordPush(false, pushed.error.message).catch(() => undefined);
        return Result.err(pushed.error);
      }
      await this.configStore.setLastSyncedRev(pushed.value.rev);
      await this.configStore.recordPush(true, `已推送至 rev ${pushed.value.rev}`);
      return Result.ok(pushed.value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.configStore.recordPush(false, detail).catch(() => undefined);
      // coordinator 侧故障（core CloudSyncError 体系）与未知异常：未知通道原样抛。
      throw error;
    } finally {
      syncBusy.release();
      if (exportTempPath != null) {
        await unlink(exportTempPath).catch(() => undefined);
      }
      if (importTempPath != null) {
        await unlink(importTempPath).catch(() => undefined);
      }
    }
  }
  /**
   * 组装 coordinator。
   *
   * @param storageOverride 仅测试用：注入内存版 storage。desktop 测试基座是
   *   node:test 零 mock 设施，没有可注入的 S3 客户端缝，不加这个参数就做不出
   *   「真库 + 内存远端」的端到端断言。
   */
  private async buildCoordinator(storageOverride?: ObjectStoragePort): Promise<
    Result<
      {
        coordinator: CloudSyncCoordinator;
        exportTempPath: string;
        importTempPath: string;
      },
      AppError
    >
  > {
    const publicConfig = await this.configStore.getPublicConfig();
    if (!publicConfig.ok) return Result.err(publicConfig.error);
    const secret = await this.configStore.getSecretAccessKey();
    if (
      publicConfig.value.endpoint.trim().length === 0 ||
      publicConfig.value.bucket.trim().length === 0 ||
      publicConfig.value.accessKeyId.trim().length === 0 ||
      publicConfig.value.deviceId.trim().length === 0 ||
      secret == null ||
      secret.length === 0
    ) {
      return Result.err(new AppError("CLOUD_SYNC_NOT_CONFIGURED", { detail: "请先配置云存储" }));
    }

    // Node 端注入基于 node:fs/promises 的 FileSystemPort（对应 A-26），
    // 与下方注入的 hashSnapshotFile 配合走 putFile / getToPath 文件路径，避免一次性读入大快照。
    const nodeFileSystem = {
      readFile: (path: string) => readFile(path),
      writeFile: (path: string, bytes: Uint8Array) => writeFile(path, bytes),
    };
    const storageConfig: S3StorageConfig = {
      endpoint: publicConfig.value.endpoint,
      region: publicConfig.value.region,
      bucket: publicConfig.value.bucket,
      accessKeyId: publicConfig.value.accessKeyId,
      secretAccessKey: secret,
      forcePathStyle: publicConfig.value.forcePathStyle,
    };
    const storage = storageOverride ?? S3ObjectStorage.create(storageConfig, { fileSystem: nodeFileSystem });

    const runtime = this.runtime;
    const stamp = Date.now();
    const exportTempPath = join(tmpdir(), `nm-cloud-sync-export-${stamp}.nmbackup`);
    const importTempPath = join(tmpdir(), `nm-cloud-sync-import-${stamp}.nmbackup`);

    const dbSync = {
      isAgentActive: () => agentActivity.isActive(),
      exportSnapshotToPath: async (destPath: string) => {
        const { DbBackupService } = await import("./db-backup.service.js");
        await DbBackupService.exportToPath(runtime, destPath);
      },
      importSnapshot: async (bytes: Uint8Array) => {
        const { DbBackupService } = await import("./db-backup.service.js");
        // 必须 return：不 return 完全合法、零类型错误，但运行时
        // databaseReplaced === undefined ⇒ handler 永不 rebootstrap ⇒ P0 原样复发。
        // 已知失败沿 Result 通道交给 coordinator（错误通道迁移七期：DbSyncPort
        // 导入面已 Result 化）；DatabaseReplacedError 仍走 throw 通道。
        return DbBackupService.importFromBytes(bytes);
      },
      importSnapshotFromPath: async (path: string) => {
        const { DbBackupService } = await import("./db-backup.service.js");
        return DbBackupService.importFromPath(path);
      },
    };

    return Result.ok({
      coordinator: new CloudSyncCoordinator({
        storage,
        dbSync,
        pathPrefix: publicConfig.value.pathPrefix,
        deviceId: publicConfig.value.deviceId,
        exportTempPath,
        importTempPath,
        computeSha256Hex: (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"),
        hashSnapshotFile: async (path: string): Promise<string> =>
          new Promise((resolve, reject) => {
            const hash = createHash("sha256");
            const stream = createReadStream(path, { highWaterMark: 512 * 1024 });
            stream.on("data", (chunk) => hash.update(chunk));
            stream.on("end", () => resolve(hash.digest("hex")));
            stream.on("error", reject);
          }),
        readSnapshotBytes: async (path: string) => readFile(path),
        getSnapshotBytes: async (path: string) => {
          const info = await stat(path);
          return info.size;
        },
      }),
      exportTempPath,
      importTempPath,
    });
  }
}

/**
 * 测试用：让 pull 走注入的 storage（内存版远端）。
 *
 * desktop 测试基座是 node:test 零 mock 设施，而 S3 客户端是在
 * `buildCoordinator` 内部现场构造的，没有可 patch 的缝 ⇒ 端到端断言
 * （真库 + 内存远端）只能靠这个注入点。传 null 恢复生产路径。
 */
let storageOverrideForTest: ObjectStoragePort | undefined;

/**
 * 云同步单例——**与 runtime 同寿命；runtime 换代时必须重建**。
 *
 * 旧实现只在首次构造时用 runtime，此后每次调用虽然都取新 runtime
 * 却不更新，于是 rebootstrap 之后拿到的是「新 runtime 外面套着旧 service」：
 * 旧 service 的 configStore 绑旧 kkv、buildCoordinator 里的 dbSync 用的也是
 * 旧 runtime ⇒ 面板全线 `CONNECTION_CLOSED` 直到重启应用。
 * 现在按 runtime 对象身份比较换代，两条 rebootstrap 生产路径（pull 之后、
 * 本地备份导入之后）都被自动覆盖。
 */
let service: DesktopCloudSyncService | undefined;

export namespace CloudSyncService {
  export function setStorageOverrideForTest(storage: ObjectStoragePort | null): void {
    storageOverrideForTest = storage ?? undefined;
  }

  export async function get(): Promise<Result<DesktopCloudSyncService, AppError>> {
    const { DesktopRuntimeSingleton } = await import("../runtime/desktop-runtime-singleton.js");
    const built = await DesktopRuntimeSingleton.get();
    if (!built.ok) return Result.err(built.error);
    const runtime = built.value;
    if (service == null || !service.isForRuntime(runtime)) {
      service = new DesktopCloudSyncService(runtime);
    }
    return Result.ok(service);
  }

  /** 测试用：重置单例与忙碌状态 */
  export function resetForTest(): void {
    service = undefined;
    syncBusy.resetForTest();
    storageOverrideForTest = undefined;
  }
}
