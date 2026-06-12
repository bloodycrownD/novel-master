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
import {createS3ObjectStorage} from '@novel-master/cloud-sync-driver-s3';
import {
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type {S3StorageConfig} from '@novel-master/cloud-sync-driver-s3';
import type {MobileNovelMasterRuntime} from '../runtime/types';
import {isMobileAgentActive} from '../runtime/agent-activity';
import {
  exportDatabaseBackupToPath,
  importDatabaseBackupFromBytes,
} from './db-backup.service';
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

/** SHA-256 十六进制（同步，供协调器校验快照） */
export function sha256Hex(bytes: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const padded = new Uint8Array(((bytes.length + 9 + 63) & ~63) >>> 0);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLen = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rightRotate(W[i - 15]!, 7) ^
        rightRotate(W[i - 15]!, 18) ^
        (W[i - 15]! >>> 3);
      const s1 =
        rightRotate(W[i - 2]!, 17) ^
        rightRotate(W[i - 2]!, 19) ^
        (W[i - 2]! >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }

    let a = H[0]!;
    let b = H[1]!;
    let c = H[2]!;
    let d = H[3]!;
    let e = H[4]!;
    let f = H[5]!;
    let g = H[6]!;
    let h = H[7]!;

    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }

  return Array.from(H, word => word.toString(16).padStart(8, '0')).join('');
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

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

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function readFileBytes(path: string): Promise<Uint8Array> {
  const base64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
  return base64ToBytes(base64);
}

async function getFileSize(path: string): Promise<number> {
  const stat = await ReactNativeBlobUtil.fs.stat(path);
  return Number(stat.size);
}

function buildS3Client(config: S3StorageConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region || 'us-east-1',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? false,
  };
  return new S3Client(clientConfig);
}

function mapSdkError(error: unknown): CloudSyncError | Error {
  if (isCloudSyncError(error)) {
    return error;
  }
  const name =
    typeof error === 'object' && error != null && 'name' in error
      ? String((error as {name: string}).name)
      : '';
  if (name === 'CredentialsProviderError' || name === 'InvalidAccessKeyId') {
    return new CloudSyncError('AUTH', '云存储凭据无效', {cause: error});
  }
  return error instanceof Error
    ? error
    : new Error(String(error));
}

async function readRemoteRev(
  runtime: MobileNovelMasterRuntime,
  s3Config?: S3StorageConfig,
): Promise<number> {
  const config = s3Config ?? (await buildS3StorageConfig(runtime));
  const storage = createS3ObjectStorage(config);
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
): Promise<{
  coordinator: CloudSyncCoordinator;
  pathPrefix: string;
  exportTempPath: string;
}> {
  const publicConfig = await getCloudSyncConfig(runtime);
  const storageConfig = s3Config ?? (await buildS3StorageConfig(runtime));
  const storage = createS3ObjectStorage(storageConfig);
  const pathPrefix = normalizePrefix(publicConfig.pathPrefix);
  const exportTempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/cloud-sync-export-${Date.now()}.nmbackup`;

  const coordinator = new CloudSyncCoordinator({
    storage,
    pathPrefix,
    deviceId: publicConfig.deviceId,
    exportTempPath,
    computeSha256Hex: sha256Hex,
    readSnapshotBytes: readFileBytes,
    getSnapshotBytes: getFileSize,
    dbSync: {
      isAgentActive: () => isMobileAgentActive(),
      exportSnapshotToPath: dest =>
        exportDatabaseBackupToPath(runtime, dest),
      importSnapshot: bytes => importDatabaseBackupFromBytes(bytes),
    },
  });

  return {coordinator, pathPrefix, exportTempPath};
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

  try {
    await client.send(new HeadBucketCommand({Bucket: s3Config.bucket}));
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

  const now = new Date().toISOString();
  const {coordinator, exportTempPath} = await createCoordinator(runtime);

  try {
    const result = await coordinator.pull({lastSyncedRev: local.lastSyncedRev});
    await patchCloudSyncLocalStatus(runtime, {
      lastSyncedRev: result.rev,
      lastPullAt: now,
      lastPullResult: 'success',
    });
    onRebootstrap();
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
      return {rev: local.lastSyncedRev, alreadyUpToDate: true};
    }
    await patchCloudSyncLocalStatus(runtime, {
      lastPullAt: now,
      lastPullResult: 'error',
    });
    throw mapSdkError(error);
  } finally {
    await ReactNativeBlobUtil.fs.unlink(exportTempPath).catch(() => undefined);
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

  const now = new Date().toISOString();
  const {coordinator, exportTempPath} = await createCoordinator(runtime);

  try {
    const result = await coordinator.push({
      lastSyncedRev: local.lastSyncedRev,
      forceOverwriteRemote: options?.forceOverwriteRemote,
    });
    await patchCloudSyncLocalStatus(runtime, {
      lastSyncedRev: result.rev,
      lastPushAt: now,
      lastPushResult: 'success',
    });
    return result;
  } catch (error) {
    await patchCloudSyncLocalStatus(runtime, {
      lastPushAt: now,
      lastPushResult: 'error',
    });
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
