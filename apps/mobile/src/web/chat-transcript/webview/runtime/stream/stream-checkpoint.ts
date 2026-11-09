/**
 * 流式检查点纯函数（spec §2.3.5 / C20）：delta 应用判定与快照合并。
 *
 * 单一真源：Web 端只应用「前一条 seq 之上」的 delta（I4）。本模块零依赖、
 * 不读 state、不碰 DOM——判定表与 merge 四象限由 stream-checkpoint.test.ts 直测。
 */
import type {StreamCheckpoint} from '../state/state';

export type {StreamCheckpoint};

type Cp = StreamCheckpoint | null;

/** delta 判定：应用 / 丢弃 / 请求普通快照。 */
type Decision = 'apply' | 'ignore' | 'resync';

/**
 * delta 判定表：
 * - 无检查点 → resync（还没有基线，等快照）；
 * - 跨流（id 不同）→ resync（跨流 seq 不可比，交普通快照对账）；
 * - 已 finished → ignore（收尾后的迟到 delta）；
 * - `seq <= applied` → ignore（重复/过期，幂等丢弃）；
 * - `seq === applied + 1` → apply；
 * - 其余（gap）→ resync（不应用半截内容，等快照）。
 *
 * nm-style: keep-public — spec C20 的纯函数对账面，stream-checkpoint.test.ts
 * 表驱动直测（判定表/merge 四象限）；生产各 1 个调用点（stream.ts /
 * snapshot.ts），撤导出会让一致性与测试双面失守。
 */
export function decideStreamDelta(cp: Cp, id: string, seq: number): Decision {
  if (cp == null) return 'resync';
  if (cp.id !== id) return 'resync';
  if (cp.status === 'finished') return 'ignore';
  if (seq <= cp.seq) return 'ignore';
  if (seq === cp.seq + 1) return 'apply';
  return 'resync';
}

/**
 * 检查点合并（只在未命中 rewind 时调用）：
 * - incoming 为空 → null（快照声明没有流式行）；
 * - local 为空 → incoming；
 * - 异 id → incoming（新流换主）；
 * - 同 id → seq 取 max、status 收尾不可逆（finished 优先）。
 *
 * nm-style: keep-public — spec C20 的纯函数对账面，stream-checkpoint.test.ts
 * 表驱动直测（判定表/merge 四象限）；生产各 1 个调用点（stream.ts /
 * snapshot.ts），撤导出会让一致性与测试双面失守。
 */
export function mergeCheckpoint(local: Cp, incoming: Cp): Cp {
  if (incoming == null) return null;
  if (local == null) return incoming;
  if (local.id !== incoming.id) return incoming;
  return {
    id: incoming.id,
    seq: Math.max(local.seq, incoming.seq),
    status:
      local.status === 'finished' || incoming.status === 'finished'
        ? 'finished'
        : 'streaming',
  };
}
