/**
 * 存储配置页「存量数据迁移」状态行的取值纯函数（从 StorageConfigScreen
 * 抽出，ic-22）：四组夹具可直测（未取到 → '—' / 已完成 / 进行中 /
 * 已完成（N 条需人工处理）），不再靠源码正则拼字面量钉分支行为。
 *
 * @module screens/stack/storage-config-migration-values
 */
import type {
  BlobBinaryTableStatus,
  MessageCompactionStatus,
} from '@/services/db-maintenance.service';

/** 迁移状态行的取值三态（颜色映射：success / warning / 默认正文色）。 */
export interface MigrationValue {
  readonly value: string;
  readonly tone: 'default' | 'success' | 'warning';
}

/**
 * 消息正文压缩（content json → zlib 压缩存储）状态行取值。
 * 未取到状态（如采样失败、Agent 运行中被守卫拒绝）显示占位 '—'。
 */
export function messageCompactionValue(
  status: MessageCompactionStatus | null,
): MigrationValue {
  if (status == null) {
    return {value: '—', tone: 'default'};
  }
  return status.done
    ? {value: '已完成', tone: 'success'}
    : {
        value: `进行中（剩余 ${status.pendingCount} 条）`,
        tone: 'default',
      };
}

/**
 * 去 base64 状态行取值（cr-06 三态）：已完成 / 已完成（N 条需人工处理）
 * / 进行中（剩余 N 条）；表未注册或未取到状态显示占位 '—'。
 */
export function blobBinaryValue(
  status: BlobBinaryTableStatus | undefined,
): MigrationValue {
  if (!status) {
    return {value: '—', tone: 'default'};
  }
  if (status.done) {
    return status.failedCount > 0
      ? {
          value: `已完成（${status.failedCount} 条需人工处理）`,
          tone: 'warning',
        }
      : {value: '已完成', tone: 'success'};
  }
  return {
    value: `进行中（剩余 ${status.pendingCount} 条）`,
    tone: 'default',
  };
}
