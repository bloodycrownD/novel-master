/**
 * Desktop 云同步服务：组装 CloudSyncCoordinator、S3 驱动与 DbSyncPort。
 *
 * @module services/cloud-sync.service
 */
import { createHash } from "node:crypto";
import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudSyncCoordinator,
  CloudSyncError,
  isCloudSyncError,
  normalizePrefix,
  parseCloudSyncStatus,
  statusKey,
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
import {
  createCloudSyncConfigStore,
  type CloudSyncConfigDto,
  type CloudSyncConfigStore,
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
};

let syncBusy = false;

function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isConfigured(config: CloudSyncConfigDto, secret: string | null): boolean {
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

function mapStorageError(error: unknown): CloudSyncError {  if (isCloudSyncError(error)) {
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
    return new CloudSyncError("AUTH", "云存储凭据无效或权限不足", { cause: error });
  }
  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  ) {
    return new CloudSyncError("NETWORK", "无法连接云存储，请检查网络与 Endpoint", {
      cause: error,
    });
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
  configStore: CloudSyncConfigStore,
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
  private readonly runtime: DesktopNovelMasterRuntime;
  private readonly configStore: CloudSyncConfigStore;

  constructor(runtime: DesktopNovelMasterRuntime) {
    this.runtime = runtime;
    this.configStore = createCloudSyncConfigStore(
      runtime.kkv,
      runtime.secretStore,
    );
  }

  async getConfig(): Promise<CloudSyncConfigDto> {
    return this.configStore.getConfig();
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
          }),
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
    const suggestsPull =
      remoteRev != null && remoteRev > lastSyncedRev;

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
    };
  }

  async pull(): Promise<{ rev: number }> {
    if (syncBusy) {
      throw new Error("云同步进行中，请稍后再试");
    }
    syncBusy = true;
    const meta = await this.configStore.getLocalMeta();
    let exportTempPath: string | undefined;
    try {
      const built = await this.buildCoordinator();
      exportTempPath = built.exportTempPath;
      const result = await built.coordinator.pull({
        lastSyncedRev: meta.lastSyncedRev,
      });
      await this.configStore.setLastSyncedRev(result.rev);
      await this.configStore.recordPull(true, `已同步至 rev ${result.rev}`);
      return result;
    } catch (error) {
      if (isCloudSyncError(error) && error.code === "ALREADY_UP_TO_DATE") {
        await this.configStore.recordPull(true, "已是最新");
        return { rev: meta.lastSyncedRev };
      }
      const detail =
        error instanceof Error ? error.message : String(error);
      await this.configStore.recordPull(false, detail).catch(() => undefined);
      throw error;
    } finally {
      syncBusy = false;
      if (exportTempPath != null) {
        await unlink(exportTempPath).catch(() => undefined);
      }
    }
  }

  async push(options?: { forceOverwriteRemote?: boolean }): Promise<{ rev: number }> {
    if (syncBusy) {
      throw new Error("云同步进行中，请稍后再试");
    }
    syncBusy = true;
    let exportTempPath: string | undefined;
    try {
      const built = await this.buildCoordinator();
      exportTempPath = built.exportTempPath;
      const meta = await this.configStore.getLocalMeta();
      const result = await built.coordinator.push({
        lastSyncedRev: meta.lastSyncedRev,
        forceOverwriteRemote: options?.forceOverwriteRemote,
      });
      await this.configStore.setLastSyncedRev(result.rev);
      await this.configStore.recordPush(true, `已推送至 rev ${result.rev}`);
      return result;
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error);
      await this.configStore.recordPush(false, detail).catch(() => undefined);
      throw error;
    } finally {
      syncBusy = false;
      if (exportTempPath != null) {
        await unlink(exportTempPath).catch(() => undefined);
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

  private async buildCoordinator(): Promise<{
    coordinator: CloudSyncCoordinator;
    exportTempPath: string;
  }> {    const publicConfig = await this.configStore.getPublicConfig();
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

    const storage = createS3ObjectStorage({
      endpoint: publicConfig.endpoint,
      region: publicConfig.region,
      bucket: publicConfig.bucket,
      accessKeyId: publicConfig.accessKeyId,
      secretAccessKey: secret,
      forcePathStyle: publicConfig.forcePathStyle,
    });

    const runtime = this.runtime;
    const exportTempPath = join(tmpdir(), `nm-cloud-sync-${Date.now()}.nmbackup`);

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
        await importDatabaseBackupFromBytes(bytes);
      },
    };

    return {
      coordinator: new CloudSyncCoordinator({
        storage,
        dbSync,
        pathPrefix: publicConfig.pathPrefix,
        deviceId: publicConfig.deviceId,
        exportTempPath,
        computeSha256Hex,
        readSnapshotBytes: async (path: string) => readFile(path),
        getSnapshotBytes: async (path: string) => {
          const info = await stat(path);
          return info.size;
        },
      }),
      exportTempPath,
    };
  }
}
let service: DesktopCloudSyncService | undefined;

export async function getDesktopCloudSyncService(): Promise<DesktopCloudSyncService> {
  const { getDesktopRuntime } = await import("../runtime/desktop-runtime-singleton.js");
  const runtime = await getDesktopRuntime();
  if (!service) {
    service = new DesktopCloudSyncService(runtime);
  }
  return service;
}

/** 测试用：重置单例与忙碌状态 */
export function resetDesktopCloudSyncServiceForTest(): void {
  service = undefined;
  syncBusy = false;
}
