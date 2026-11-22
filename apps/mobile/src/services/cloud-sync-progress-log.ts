/**
 * 云同步进度追踪：UI 回调 + `__DEV__` 日志（`npx react-native log-android` 过滤 `[cloud-sync]`）。
 * 不记录 Secret Key；S3 key 仅输出末段文件名。
 *
 * @module services/cloud-sync-progress-log
 */
import {type ObjectStoragePort} from '@novel-master/core';
import {AppErrorOps, ErrorGuards} from '@novel-master/core/errors';
import {CloudSyncProgressUi, type CloudSyncProgressListener} from './cloud-sync-progress-ui';

const LOG_TAG = '[cloud-sync]';

export type CloudSyncProgressOp = 'pull' | 'push' | 'test';

type CloudSyncProgressOptions = {
    /** 向 UI 层推送阶段进度（生产环境可用） */
    onUiProgress?: CloudSyncProgressListener;
};

type CloudSyncProgress = {
    step: (event: string, detail?: Record<string, unknown>) => void;
    done: (detail?: Record<string, unknown>) => void;
    fail: (error: unknown, detail?: Record<string, unknown>) => void;
};

/** 进度追踪器的状态槽：lastAt 是被重绑的时间游标（每步推进，供 msStep 计算）。 */
type ProgressLogState = {
    op: CloudSyncProgressOp;
    startedAt: number;
    lastAt: number;
    onUiProgress?: CloudSyncProgressListener;
};

/** 推进一站进度：UI 映射（push/pull）+ dev 日志（msTotal/msStep，lastAt 推进）。 */
function step(state: ProgressLogState, event: string, detail?: Record<string, unknown>): void {
    if (state.onUiProgress != null && (state.op === 'push' || state.op === 'pull')) {
        const uiState = CloudSyncProgressUi.mapEvent(state.op, event, detail);
        if (uiState != null) {
            state.onUiProgress(uiState);
        }
    }
    if (typeof __DEV__ === 'undefined' || !__DEV__) {
        return;
    }
    const now = Date.now();
    console.warn(LOG_TAG, event, {
        op: state.op,
        msTotal: now - state.startedAt,
        msStep: now - state.lastAt,
        ...detail,
    });
    state.lastAt = now;
}

/** 收尾站：`step(`${op}_done`)`（名称保留——CloudSyncProgress 接口契约）。 */
function done(state: ProgressLogState, detail?: Record<string, unknown>): void {
    step(state, `${state.op}_done`, detail);
}

/** 失败站：错误名抽取（CLOUD_SYNC 域错误带 key）+ `step(`${op}_failed`)`。 */
function fail(state: ProgressLogState, error: unknown, detail?: Record<string, unknown>): void {
    step(state, `${state.op}_failed`, {
        error: error instanceof Error ? error.message : String(error),
        key: AppErrorOps.is(error) && ErrorGuards.domainOf(error.code) === 'CLOUD_SYNC' ? error.key : undefined,
        ...detail,
    });
}

export namespace CloudSyncProgressLog {
    /** 日志用 key 缩写（避免路径过长）。 */
    export function shortStorageKey(key: string): string {
        const parts = key.split('/').filter(Boolean);
        if (parts.length <= 2) {
            return key;
        }
        return `…/${parts.slice(-2).join('/')}`;
    }

    /** 创建带耗时的进度追踪器（`msTotal` / `msStep` + 可选 UI 回调）。 */
    export function create(op: CloudSyncProgressOp, options?: CloudSyncProgressOptions): CloudSyncProgress {
        const startedAt = Date.now();
        const state: ProgressLogState = {op, startedAt, lastAt: startedAt, onUiProgress: options?.onUiProgress};
        return {
            step: (event, detail) => step(state, event, detail),
            done: detail => done(state, detail),
            fail: (error, detail) => fail(state, error, detail),
        };
    }

    /** 包装 ObjectStoragePort，记录 head/get/put/putFile/getToPath 各阶段。 */
    // nm-style: keep-public — cloud-sync-progress-log.test.ts 直接 import 断言各阶段日志，测试锁名
    export function withStorageProgress(storage: ObjectStoragePort, progress: CloudSyncProgress): ObjectStoragePort {
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
                // put/putFile/getToPath 已知失败走 Result.err（错误通道迁移六期）：
                // 记一条失败阶段便于 dev 日志定位，结果原样转发给协调器收口。
                if (!result.ok) {
                    progress.step('storage_put_failed', {key: shortStorageKey(key)});
                    return result;
                }
                progress.step('storage_put_done', {
                    key: shortStorageKey(key),
                    etagPrefix: result.value.etag.slice(0, 12),
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
                if (!result.ok) {
                    progress.step('storage_put_file_failed', {key: shortStorageKey(key)});
                    return result;
                }
                progress.step('storage_put_file_done', {
                    key: shortStorageKey(key),
                    etagPrefix: result.value.etag.slice(0, 12),
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
                if (!result.ok) {
                    progress.step('storage_get_to_path_failed', {
                        key: shortStorageKey(key),
                    });
                    return result;
                }
                progress.step('storage_get_to_path_done', {
                    key: shortStorageKey(key),
                    etagPrefix: result.value.etag.slice(0, 12),
                });
                return result;
            };
        }

        return wrapped;
    }
}
