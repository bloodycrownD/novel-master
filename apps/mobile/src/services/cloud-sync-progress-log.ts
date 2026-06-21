/**
 * 云同步进度追踪：UI 回调 + `__DEV__` 日志（`npx react-native log-android` 过滤 `[cloud-sync]`）。
 * 不记录 Secret Key；S3 key 仅输出末段文件名。
 *
 * @module services/cloud-sync-progress-log
 */
import {isCloudSyncError, type ObjectStoragePort} from '@novel-master/core';
import {
  mapCloudSyncProgressEvent,
  type CloudSyncProgressListener,
} from './cloud-sync-progress-ui';

const LOG_TAG = '[cloud-sync]';

export type CloudSyncProgressOp = 'pull' | 'push' | 'test';

export type CloudSyncProgressOptions = {
  /** 向 UI 层推送阶段进度（生产环境可用） */
  onUiProgress?: CloudSyncProgressListener;
};

export type CloudSyncProgress = {
  step: (event: string, detail?: Record<string, unknown>) => void;
  done: (detail?: Record<string, unknown>) => void;
  fail: (error: unknown, detail?: Record<string, unknown>) => void;
};

/** 日志用 key 缩写（避免路径过长）。 */
export function shortStorageKey(key: string): string {
  const parts = key.split('/').filter(Boolean);
  if (parts.length <= 2) {
    return key;
  }
  return `…/${parts.slice(-2).join('/')}`;
}

function isDevLogEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

/** 创建带耗时的进度追踪器（`msTotal` / `msStep` + 可选 UI 回调）。 */
export function createCloudSyncProgress(
  op: CloudSyncProgressOp,
  options?: CloudSyncProgressOptions,
): CloudSyncProgress {
  const startedAt = Date.now();
  let lastAt = startedAt;
  const onUiProgress = options?.onUiProgress;

  const emitUi = (
    event: string,
    detail?: Record<string, unknown>,
  ): void => {
    if (onUiProgress == null || (op !== 'push' && op !== 'pull')) {
      return;
    }
    const uiState = mapCloudSyncProgressEvent(op, event, detail);
    if (uiState != null) {
      onUiProgress(uiState);
    }
  };

  const step = (event: string, detail?: Record<string, unknown>): void => {
    emitUi(event, detail);
    if (!isDevLogEnabled()) {
      return;
    }
    const now = Date.now();
    console.warn(LOG_TAG, event, {
      op,
      msTotal: now - startedAt,
      msStep: now - lastAt,
      ...detail,
    });
    lastAt = now;
  };

  const done = (detail?: Record<string, unknown>): void => {
    step(`${op}_done`, detail);
  };

  const fail = (error: unknown, detail?: Record<string, unknown>): void => {
    step(`${op}_failed`, {
      error: error instanceof Error ? error.message : String(error),
      code: isCloudSyncError(error) ? error.code : undefined,
      ...detail,
    });
  };

  return {step, done, fail};
}

/** 包装 ObjectStoragePort，记录 head/get/put/putFile/getToPath 各阶段。 */
export function withCloudSyncStorageProgress(
  storage: ObjectStoragePort,
  progress: CloudSyncProgress,
): ObjectStoragePort {
  const wrapped: ObjectStoragePort = {
    async head(key) {
      progress.step('storage_head_start', {key: shortStorageKey(key)});
      const result = await storage.head(key);
      progress.step('storage_head_done', {
        key: shortStorageKey(key),
        exists: result.exists,
      });
      return result;
    },

    async get(key) {
      progress.step('storage_get_start', {key: shortStorageKey(key)});
      const result = await storage.get(key);
      progress.step('storage_get_done', {
        key: shortStorageKey(key),
        bytes: result.body.byteLength,
      });
      return result;
    },

    async put(key, body, options) {
      progress.step('storage_put_start', {
        key: shortStorageKey(key),
        bytes: body.byteLength,
        conditional: options?.ifMatch != null || options?.ifNoneMatch != null,
      });
      const result = await storage.put(key, body, options);
      progress.step('storage_put_done', {
        key: shortStorageKey(key),
        etagPrefix: result.etag?.slice(0, 12),
      });
      return result;
    },
  };

  if (typeof storage.putFile === 'function') {
    wrapped.putFile = async (key, filePath, options) => {
      progress.step('storage_put_file_start', {
        key: shortStorageKey(key),
        fromPath: true,
        conditional: options?.ifMatch != null || options?.ifNoneMatch != null,
      });
      const result = await storage.putFile!(key, filePath, options);
      progress.step('storage_put_file_done', {
        key: shortStorageKey(key),
        etagPrefix: result.etag?.slice(0, 12),
      });
      return result;
    };
  }

  if (typeof storage.getToPath === 'function') {
    wrapped.getToPath = async (key, destPath) => {
      progress.step('storage_get_to_path_start', {
        key: shortStorageKey(key),
        toPath: true,
      });
      const result = await storage.getToPath!(key, destPath);
      progress.step('storage_get_to_path_done', {
        key: shortStorageKey(key),
        etagPrefix: result.etag?.slice(0, 12),
      });
      return result;
    };
  }

  return wrapped;
}
