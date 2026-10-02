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
import {
  CloudSyncCoordinator,
  CloudSyncError,
  isCloudSyncError,
  normalizePrefix,
  parseCloudSyncStatus,
  statusKey,
  type ObjectStoragePort,
} from "@novel-master/core";
import { createS3ObjectStorage } from "@novel-master/cloud-sync-driver-s3";
import type { S3StorageConfig } from "@novel-master/cloud-sync-driver-s3";
import {
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { isDesktopAgentActive } from "../runtime/agent-activity.js";
import { isDesktopDbMaintenanceBusy } from "./db-maintenance-busy.js";
import {
  createCloudSyncConfigStore,
  type CloudSyncConfigDto,
  type CloudSyncConfigStore,
  type CloudSyncLocalMeta,
  type CloudSyncSetConfigInput,
} from "./cloud-sync-config.store.js";

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

let syncBusy = false;

/** 云同步（pull/push）是否进行中：供数据清理等数据库操作的入口守卫使用。 */
export function isDesktopCloudSyncBusy(): boolean {
  return syncBusy;
}

function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 分块从文件计算 SHA-256 十六进制 */
async function hashSnapshotFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path, { highWaterMark: 512 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function isConfigured(
  config: CloudSyncConfigDto,
  secret: string | null
): boolean {
  return (
    config.enabled &&
    config.endpoint.trim().length > 0 &&
    config.bucket.trim().length > 0 &&
    config.accessKeyId.trim().length > 0 &&
    config.deviceId.trim().length > 0 &&
    secret != null &&
    secret.length > 0
  );
}

/**
 * 判断一个错误是不是「本机数据库已换代」（`DatabaseReplacedError`）。
 *
 * **刻意用动态 import**，与本文件下面 dbSync 三个端口处理 `db-backup.service.js`
 * 的写法同款：`db-backup.service.ts` 静态 import 了 `desktop-runtime-singleton.js`
 * 与 electron，本服务已经动态 import 前者，静态边会把这条链的初始化顺序搅乱
 * （见 `invalidateDesktopCloudSyncService` 的 JSDoc 里对静态环的说明）。
 */
async function isDatabaseReplacedError(error: unknown): Promise<boolean> {
  const { DatabaseReplacedError } = await import("./db-backup.service.js");
  return error instanceof DatabaseReplacedError;
}

function mapStorageError(error: unknown): CloudSyncError {
  if (isCloudSyncError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("access denied") ||
    lower.includes("invalidaccesskeyid") ||
    lower.includes("signaturedoesnotmatch") ||
    lower.includes("403")
  ) {
    return new CloudSyncError("AUTH", "云存储凭据无效或权限不足", {
      cause: error,
    });
  }
  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  ) {
    return new CloudSyncError(
      "NETWORK",
      "无法连接云存储，请检查网络与 Endpoint",
      {
        cause: error,
      }
    );
  }
  return new CloudSyncError("NETWORK", message, { cause: error });
}

function buildS3Client(config: S3StorageConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region || "us-east-1",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? false,
  };
  return new S3Client(clientConfig);
}

async function buildS3StorageConfigFromStore(
  configStore: CloudSyncConfigStore
): Promise<S3StorageConfig> {
  const publicConfig = await configStore.getPublicConfig();
  const secret = await configStore.getSecretAccessKey();
  if (secret == null || secret.length === 0) {
    throw new CloudSyncError("NOT_CONFIGURED", "请先配置云存储");
  }
  return {
    endpoint: publicConfig.endpoint,
    region: publicConfig.region,
    bucket: publicConfig.bucket,
    accessKeyId: publicConfig.accessKeyId,
    secretAccessKey: secret,
    forcePathStyle: publicConfig.forcePathStyle,
  };
}
export class DesktopCloudSyncService {
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
    this.configStore = createCloudSyncConfigStore(
      runtime.kkv,
      runtime.secretStore
    );
  }

  async getConfig(): Promise<CloudSyncConfigDto> {
    return this.configStore.getConfig();
  }

  /** 本实例是否属于该 runtime 那一代（单例按身份换代用）。 */
  isForRuntime(runtime: DesktopNovelMasterRuntime): boolean {
    return this.runtimeIdentity === runtime;
  }

  async setConfig(input: CloudSyncSetConfigInput): Promise<void> {
    await this.configStore.setConfig(input);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.configStore.setEnabled(enabled);
  }

  async testConnection(): Promise<void> {
    const s3Config = await buildS3StorageConfigFromStore(this.configStore);
    const client = buildS3Client(s3Config);
    const publicConfig = await this.configStore.getPublicConfig();
    const pathPrefix = normalizePrefix(publicConfig.pathPrefix);

    try {
      await client.send(new HeadBucketCommand({ Bucket: s3Config.bucket }));
    } catch (headError) {
      try {
        await client.send(
          new ListObjectsV2Command({
            Bucket: s3Config.bucket,
            Prefix: pathPrefix,
            MaxKeys: 1,
          })
        );
      } catch (listError) {
        throw mapStorageError(listError ?? headError);
      }
    }
  }
  async getLocalStatus(): Promise<CloudSyncLocalStatusDto> {
    const config = await this.configStore.getConfig();
    const meta = await this.configStore.getLocalMeta();
    const secret = await this.configStore.getSecretAccessKey();
    const configured = isConfigured(config, secret);
    const agentActive = isDesktopAgentActive();

    let remoteRev: number | undefined;
    if (configured) {
      try {
        remoteRev = await this.readRemoteRev();
      } catch {
        remoteRev = undefined;
      }
    }

    const lastSyncedRev = meta.lastSyncedRev;
    const suggestsPull = remoteRev != null && remoteRev > lastSyncedRev;

    return {
      configured,
      deviceId: config.deviceId || undefined,
      deviceLabel: config.deviceLabel || undefined,
      lastSyncedRev,
      remoteRev,
      lastPullAt: meta.lastPullAt || undefined,
      lastPushAt: meta.lastPushAt || undefined,
      lastPullResult: meta.lastPullResult || undefined,
      lastPushResult: meta.lastPushResult || undefined,
      suggestsPull,
      syncBusy,
      agentActive,
      maintenanceBusy: isDesktopDbMaintenanceBusy(),
    };
  }

  /**
   * 拉取并导入远端快照。
   *
   * 契约顺序：**换库 → 重建 runtime → 用新 runtime 记账 → 再放互斥令牌**。
   * 本方法只做「换库」并回报 `databaseReplaced`；**换代成功时不在此处记账**
   * ——此刻 `this.configStore` 背后的连接刚被 `importDatabaseBackupFrom*` 关掉，
   * 记账会抛 `CONNECTION_CLOSED`（且抛错发生在 recordPull 之前，把已完成的
   * 拉取记成失败，rev 永不推进）。记账改由 handler 在
   * `rebootstrapDesktopRuntime()` 之后调 {@link recordPullSuccess} 完成。
   *
   * `ALREADY_UP_TO_DATE` 早返回分支与失败分支仍在本处记账：**库没换、连接没关**，
   * 此时旧 runtime 仍是活的，记账句柄有效。该早返回对象的
   * `databaseReplaced` 恒为 `false`。
   */
  async pull(): Promise<{ rev: number; databaseReplaced: boolean }> {
    if (syncBusy) {
      throw new Error("云同步进行中，请稍后再试");
    }
    syncBusy = true;
    let meta: CloudSyncLocalMeta | undefined;
    let exportTempPath: string | undefined;
    let importTempPath: string | undefined;
    try {
      // getLocalMeta 的读取必须在 try 内（对齐 push() 写法）：若留在
      // try 外，抛错时 syncBusy 永不复位，数据清理守卫会被连带锁死。
      meta = await this.configStore.getLocalMeta();
      const built = await this.buildCoordinator(storageOverrideForTest);
      exportTempPath = built.exportTempPath;
      importTempPath = built.importTempPath;
      const result = await built.coordinator.pull({
        lastSyncedRev: meta.lastSyncedRev,
      });
      return result;
    } catch (error) {
      if (isCloudSyncError(error) && error.code === "ALREADY_UP_TO_DATE") {
        // 该错误只可能由 coordinator.pull 抛出，此时 meta 必已赋值。
        await this.configStore.recordPull(true, "已是最新");
        return { rev: meta?.lastSyncedRev ?? 0, databaseReplaced: false };
      }
      const detail = error instanceof Error ? error.message : String(error);
      // ⚠️ `DatabaseReplacedError` 这一支**不做 recordPull**（CR cloudsync P2-1）。
      // 此刻 `closeLiveDbForBackupImport()` 已经把 `this.configStore` 背后的连接
      // 关掉了 ⇒ `recordPull` 必抛 `CONNECTION_CLOSED` ⇒ 被下面的 `.catch` 吃掉
      // ⇒ 面板上「上次拉取结果」永远停在旧值，与实际发生的「换代成功但三表未恢复」
      // 永久不一致。**一次注定失败的写还不如不写**：它既不产生任何信息，还制造
      // 一次「以为自己记过了」的错觉。
      // 换代路径的记账由 handler 在 `rebootstrapDesktopRuntime()` 之后走
      // `recordPullSuccess()` 现场造 store 来做（见该方法 JSDoc），不依赖本支。
      if (!(await isDatabaseReplacedError(error))) {
        await this.configStore.recordPull(false, detail).catch(() => undefined);
      }
      throw error;
    } finally {
      syncBusy = false;
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
   * 必须现取：handler 在 `rebootstrapDesktopRuntime()` **之前**捕获的 service
   * 仍是旧代实例，其 `configStore` 绑的是已被关掉的连接——按身份重建救不了
   * 旧实例上的方法调用。`getDesktopRuntime()` 在 `closeLiveDbForBackupImport`
   * 之后会懒建出一个**新对象**，这里的 store 因此必然绑在活连接上。
   */
  async recordPullSuccess(rev: number): Promise<void> {
    const { getDesktopRuntime } = await import(
      "../runtime/desktop-runtime-singleton.js"
    );
    const rt = await getDesktopRuntime();
    const store = createCloudSyncConfigStore(rt.kkv, rt.secretStore);
    await store.setLastSyncedRev(rev);
    await store.recordPull(true, `已同步至 rev ${rev}`);
  }

  async push(options?: {
    forceOverwriteRemote?: boolean;
  }): Promise<{ rev: number }> {
    if (syncBusy) {
      throw new Error("云同步进行中，请稍后再试");
    }
    syncBusy = true;
    let exportTempPath: string | undefined;
    let importTempPath: string | undefined;
    try {
      const built = await this.buildCoordinator();
      exportTempPath = built.exportTempPath;
      importTempPath = built.importTempPath;
      const meta = await this.configStore.getLocalMeta();
      const result = await built.coordinator.push({
        lastSyncedRev: meta.lastSyncedRev,
        forceOverwriteRemote: options?.forceOverwriteRemote,
      });
      await this.configStore.setLastSyncedRev(result.rev);
      await this.configStore.recordPush(true, `已推送至 rev ${result.rev}`);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.configStore.recordPush(false, detail).catch(() => undefined);
      throw error;
    } finally {
      syncBusy = false;
      if (exportTempPath != null) {
        await unlink(exportTempPath).catch(() => undefined);
      }
      if (importTempPath != null) {
        await unlink(importTempPath).catch(() => undefined);
      }
    }
  }
  private async readRemoteRev(): Promise<number> {
    const storage = await this.buildStorage();
    const publicConfig = await this.configStore.getPublicConfig();
    const key = statusKey(publicConfig.pathPrefix);
    const head = await storage.head(key);
    if (!head.exists) {
      return 0;
    }
    const { body } = await storage.get(key);
    const parsed = JSON.parse(new TextDecoder().decode(body));
    return parseCloudSyncStatus(parsed).rev;
  }

  private async buildStorage() {
    const publicConfig = await this.configStore.getPublicConfig();
    const secret = await this.configStore.getSecretAccessKey();
    if (secret == null || secret.length === 0) {
      throw new CloudSyncError("NOT_CONFIGURED", "请先配置云存储");
    }
    return createS3ObjectStorage({
      endpoint: publicConfig.endpoint,
      region: publicConfig.region,
      bucket: publicConfig.bucket,
      accessKeyId: publicConfig.accessKeyId,
      secretAccessKey: secret,
      forcePathStyle: publicConfig.forcePathStyle,
    });
  }

  /**
   * 组装 coordinator。
   *
   * @param storageOverride 仅测试用：注入内存版 storage。desktop 测试基座是
   *   node:test 零 mock 设施，没有可注入的 S3 客户端缝，不加这个参数就做不出
   *   「真库 + 内存远端」的端到端断言。
   */
  private async buildCoordinator(storageOverride?: ObjectStoragePort): Promise<{
    coordinator: CloudSyncCoordinator;
    exportTempPath: string;
    importTempPath: string;
  }> {
    const publicConfig = await this.configStore.getPublicConfig();
    const secret = await this.configStore.getSecretAccessKey();
    if (
      publicConfig.endpoint.trim().length === 0 ||
      publicConfig.bucket.trim().length === 0 ||
      publicConfig.accessKeyId.trim().length === 0 ||
      publicConfig.deviceId.trim().length === 0 ||
      secret == null ||
      secret.length === 0
    ) {
      throw new CloudSyncError("NOT_CONFIGURED", "请先配置云存储");
    }

    // Node 端注入基于 node:fs/promises 的 FileSystemPort（对应 A-26），
    // 与 hashSnapshotFile 配合走 putFile / getToPath 文件路径，避免一次性读入大快照。
    const nodeFileSystem = {
      readFile: (path: string) => readFile(path),
      writeFile: (path: string, bytes: Uint8Array) => writeFile(path, bytes),
    };
    const storage =
      storageOverride ??
      createS3ObjectStorage(
        {
          endpoint: publicConfig.endpoint,
          region: publicConfig.region,
          bucket: publicConfig.bucket,
          accessKeyId: publicConfig.accessKeyId,
          secretAccessKey: secret,
          forcePathStyle: publicConfig.forcePathStyle,
        },
        { fileSystem: nodeFileSystem }
      );

    const runtime = this.runtime;
    const stamp = Date.now();
    const exportTempPath = join(
      tmpdir(),
      `nm-cloud-sync-export-${stamp}.nmbackup`
    );
    const importTempPath = join(
      tmpdir(),
      `nm-cloud-sync-import-${stamp}.nmbackup`
    );

    const dbSync = {
      isAgentActive: () => isDesktopAgentActive(),
      exportSnapshotToPath: async (destPath: string) => {
        const { exportDatabaseBackupToPath } = await import(
          "./db-backup.service.js"
        );
        await exportDatabaseBackupToPath(runtime, destPath);
      },
      importSnapshot: async (bytes: Uint8Array) => {
        const { importDatabaseBackupFromBytes } = await import(
          "./db-backup.service.js"
        );
        // 必须 return：不 return 完全合法、零类型错误，但运行时
        // databaseReplaced === undefined ⇒ handler 永不 rebootstrap ⇒ P0 原样复发。
        return importDatabaseBackupFromBytes(bytes);
      },
      importSnapshotFromPath: async (path: string) => {
        const { importDatabaseBackupFromPath } = await import(
          "./db-backup.service.js"
        );
        return importDatabaseBackupFromPath(path);
      },
    };

    return {
      coordinator: new CloudSyncCoordinator({
        storage,
        dbSync,
        pathPrefix: publicConfig.pathPrefix,
        deviceId: publicConfig.deviceId,
        exportTempPath,
        importTempPath,
        computeSha256Hex,
        hashSnapshotFile,
        readSnapshotBytes: async (path: string) => readFile(path),
        getSnapshotBytes: async (path: string) => {
          const info = await stat(path);
          return info.size;
        },
      }),
      exportTempPath,
      importTempPath,
    };
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

export function __setDesktopCloudSyncStorageOverrideForTest(
  storage: ObjectStoragePort | null,
): void {
  storageOverrideForTest = storage ?? undefined;
}

/**
 * 云同步单例——**与 runtime 同寿命；runtime 换代时必须重建**。
 *
 * 旧实现只在首次构造时用 runtime，此后每次调用虽然都 `await getDesktopRuntime()`
 * 却不更新，于是 rebootstrap 之后拿到的是「新 runtime 外面套着旧 service」：
 * 旧 service 的 configStore 绑旧 kkv、buildCoordinator 里的 dbSync 用的也是
 * 旧 runtime ⇒ 面板全线 `CONNECTION_CLOSED` 直到重启应用。
 * 现在按 runtime 对象身份比较换代，两条 rebootstrap 生产路径（pull 之后、
 * 本地备份导入之后）都被自动覆盖。
 */
let service: DesktopCloudSyncService | undefined;

export async function getDesktopCloudSyncService(): Promise<DesktopCloudSyncService> {
  const { getDesktopRuntime } = await import(
    "../runtime/desktop-runtime-singleton.js"
  );
  const runtime = await getDesktopRuntime();
  if (service == null || !service.isForRuntime(runtime)) {
    service = new DesktopCloudSyncService(runtime);
  }
  return service;
}

/**
 * 生产版清位入口：手动让下次 `getDesktopCloudSyncService()` 重建。
 *
 * 刻意**不**挂到 `rebootstrapDesktopRuntime()` 上——那会形成
 * `runtime-singleton → cloud-sync.service` 的静态环（service 已经动态
 * import runtime-singleton），静态环会破坏 db-backup-busy 的导入顺序。
 * 身份比较已经自愈，本函数只留给将来手动降级用。
 */
export function invalidateDesktopCloudSyncService(): void {
  service = undefined;
}

/** 测试用：重置单例与忙碌状态 */
export function resetDesktopCloudSyncServiceForTest(): void {
  service = undefined;
  syncBusy = false;
  storageOverrideForTest = undefined;
}

/** 测试用：直接置位云同步忙碌状态（模拟 pull/push 执行窗口）。 */
export function setDesktopCloudSyncBusyForTest(busy: boolean): void {
  syncBusy = busy;
}
