/**
 * 云同步进度 → UI 文案与阶段进度（0–1）。
 *
 * @module services/cloud-sync-progress-ui
 */
import type {CloudSyncProgressOp} from './cloud-sync-progress-log';

/** 供遮罩层展示的云同步进度快照 */
export type CloudSyncProgressUiState = {
  op: CloudSyncProgressOp;
  event: string;
  label: string;
  /** 0–1，阶段估算进度 */
  progress: number;
  /** 网络传输等无法精确计量的阶段 */
  indeterminate?: boolean;
};

export type CloudSyncProgressListener = (
  state: CloudSyncProgressUiState,
) => void;

type StepRule = {
  label: string;
  progress: number;
  indeterminate?: boolean;
};

/** Push 事件 → UI 规则（按典型执行顺序） */
const PUSH_RULES: Record<string, StepRule> = {
  start: {label: '准备推送…', progress: 0.02},
  coordinator_push_start: {label: '连接云端…', progress: 0.05},
  storage_head_start: {label: '检查云端状态…', progress: 0.08},
  storage_get_start: {label: '读取云端状态…', progress: 0.1},
  storage_put_start: {label: '获取同步锁…', progress: 0.14},
  storage_put_done: {label: '同步锁已获取', progress: 0.18},
  db_export_start: {label: '导出本地数据库…', progress: 0.22},
  db_export_done: {label: '导出完成', progress: 0.28},
  sha256_file_start: {label: '校验快照…', progress: 0.32},
  sha256_start: {label: '校验快照…', progress: 0.32},
  sha256_file_done: {label: '校验完成', progress: 0.38},
  sha256_done: {label: '校验完成', progress: 0.38},
  read_snapshot_start: {label: '读取快照…', progress: 0.32},
  read_snapshot_done: {label: '读取完成', progress: 0.38},
  storage_put_file_start: {
    label: '上传快照到云端…',
    progress: 0.42,
    indeterminate: true,
  },
  storage_put_start_large: {
    label: '上传快照到云端…',
    progress: 0.42,
    indeterminate: true,
  },
  storage_put_file_done: {label: '快照已上传', progress: 0.88},
  storage_put_done_large: {label: '快照已上传', progress: 0.88},
  push_done: {label: '推送完成', progress: 1},
};

/** Pull 事件 → UI 规则 */
const PULL_RULES: Record<string, StepRule> = {
  start: {label: '准备拉取…', progress: 0.02},
  coordinator_pull_start: {label: '连接云端…', progress: 0.05},
  storage_head_start: {label: '检查云端状态…', progress: 0.08},
  storage_get_start: {label: '读取云端状态…', progress: 0.12},
  storage_get_to_path_start: {
    label: '下载云端快照…',
    progress: 0.18,
    indeterminate: true,
  },
  storage_get_start_large: {
    label: '下载云端快照…',
    progress: 0.18,
    indeterminate: true,
  },
  storage_get_to_path_done: {label: '下载完成', progress: 0.72},
  storage_get_done_large: {label: '下载完成', progress: 0.72},
  sha256_file_start: {label: '校验快照…', progress: 0.76},
  sha256_start: {label: '校验快照…', progress: 0.76},
  sha256_file_done: {label: '校验完成', progress: 0.82},
  sha256_done: {label: '校验完成', progress: 0.82},
  db_import_start: {label: '导入数据库…', progress: 0.86},
  db_import_done: {label: '导入完成', progress: 0.95},
  pull_done: {label: '拉取完成', progress: 1},
};

const SNAPSHOT_BYTE_THRESHOLD = 64 * 1024;

function resolveEventKey(
  op: CloudSyncProgressOp,
  event: string,
  detail?: Record<string, unknown>,
): string {
  if (event.endsWith('_done') || event.endsWith('_failed')) {
    return event;
  }

  const bytes =
    typeof detail?.bytes === 'number' ? detail.bytes : undefined;
  const isLargeSnapshot =
    bytes != null && bytes >= SNAPSHOT_BYTE_THRESHOLD;
  const isSnapshotKey =
    typeof detail?.key === 'string' &&
    (detail.key.includes('snapshots/') ||
      detail.key.includes('.nmbackup'));

  if (op === 'push') {
    if (
      (event === 'storage_put_start' || event === 'storage_put_file_start') &&
      (isLargeSnapshot || isSnapshotKey || detail?.fromPath === true)
    ) {
      return event === 'storage_put_file_start'
        ? 'storage_put_file_start'
        : 'storage_put_start_large';
    }
    if (
      (event === 'storage_put_done' || event === 'storage_put_file_done') &&
      (isLargeSnapshot || isSnapshotKey || detail?.fromPath === true)
    ) {
      return event === 'storage_put_file_done'
        ? 'storage_put_file_done'
        : 'storage_put_done_large';
    }
  }

  if (op === 'pull') {
    if (
      event === 'storage_get_start' &&
      (isLargeSnapshot || isSnapshotKey)
    ) {
      return 'storage_get_start_large';
    }
    if (
      event === 'storage_get_done' &&
      (isLargeSnapshot || isSnapshotKey)
    ) {
      return 'storage_get_done_large';
    }
  }

  return event;
}

/** 将内部 progress 事件映射为 UI 状态；未知事件返回 null。 */
export function mapCloudSyncProgressEvent(
  op: CloudSyncProgressOp,
  event: string,
  detail?: Record<string, unknown>,
): CloudSyncProgressUiState | null {
  if (op !== 'push' && op !== 'pull') {
    return null;
  }

  const rules = op === 'push' ? PUSH_RULES : PULL_RULES;
  const key = resolveEventKey(op, event, detail);
  let rule = rules[key];

  if (rule == null && event === `${op}_done`) {
    rule = rules[`${op}_done`];
  }

  if (rule == null) {
    return null;
  }

  return {
    op,
    event,
    label: rule.label,
    progress: rule.progress,
    indeterminate: rule.indeterminate,
  };
}

/** 同步开始时的初始 UI 状态 */
export function initialCloudSyncProgressUi(
  op: 'push' | 'pull',
): CloudSyncProgressUiState {
  return {
    op,
    event: 'start',
    label: op === 'push' ? '准备推送…' : '准备拉取…',
    progress: 0.02,
  };
}
