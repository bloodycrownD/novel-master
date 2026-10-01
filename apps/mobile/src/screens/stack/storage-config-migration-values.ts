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
  VfsContentPackStatus,
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

/**
 * VFS 历史版本打包状态行取值（第四行）：无需处理 / 剩余 N 组两态 +
 * failedGroups > 0 第三态「已完成（N 组需人工处理）」；未取到状态（采样
 * 失败）显示占位 '—'。
 *
 * 与 blobBinaryValue 的 done 分支不同：打包无终态（新版本持续攒组），
 * 「收敛」判定取 `pendingGroups === 0`——此时尚有坏组（failedGroups
 * 快照非零）则显示第三态，完全干净则显示「无需处理」（新库从未打包 /
 * 存量已全部打包收敛，从用户视角均无可等待的迁移进度）。
 *
 * **第三态口径**：「已完成（N 组需人工处理）」里的 N 是**上次收敛轮**写下的
 * failedGroups 快照——「已完成」只限定为「当前候选已收敛」这一轮
 * （pendingGroups 为 0），不代表此后再无候选：新版本攒出新组后状态行会
 * 重新回到「剩余 N 组」。文案本身是 spec 拍板口径，此处只补边界说明。
 */
export function vfsPackValue(
  status: VfsContentPackStatus | null,
): MigrationValue {
  if (status == null) {
    return {value: '—', tone: 'default'};
  }
  if (status.pendingGroups > 0) {
    return {
      value: `剩余 ${status.pendingGroups} 组`,
      tone: 'default',
    };
  }
  if (status.failedGroups > 0) {
    return {
      value: `已完成（${status.failedGroups} 组需人工处理）`,
      tone: 'warning',
    };
  }
  return {value: '无需处理', tone: 'success'};
}
