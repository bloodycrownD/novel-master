/**
 * 日志文件轮转策略（纯函数，三端 sink 共用）。
 *
 * core 决定「切到哪个文件名、删哪几份」；端上只负责把结果落到自己的目录。
 * 调用方两条硬性约定（策略是纯函数，不回写任何状态）：
 * - 必须按 `baseName` 预过滤 `existing`（不同前缀互不干扰）；
 * - 必须自己维护「当前目标文件已写字节」并在每次 append 后累加，安装时用
 *   `stat` 校准一次——否则 `bytes + appendBytes > maxBytes` 永远不成立。
 *
 * @module infra/log/log-file-policy
 */

/** 目录里的一份同名家族日志文件（`name` 不含目录）。 */
// nm-style: keep-public — 三端文件 sink 构造 `existing` 的入参类型，core 内部无消费者。
export interface LogFileEntry {
  readonly name: string;
  readonly mtimeMs: number;
  readonly bytes: number;
}

/** 本次写入计划：append 目标 + 应删除的文件名。 */
// nm-style: keep-public — 三端文件 sink 消费 planLogFileWrite 的返回类型。
export interface LogFilePlan {
  /** 本次要 append 的目标文件名（不含目录）。 */
  readonly targetName: string;
  /** 本次应删除的文件名（按 mtime 从旧到新）。 */
  readonly deleteNames: readonly string[];
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_KEEP = 5;
/** 分段号上限：超了退到 `<baseName>.<hhmmss>.log`，避免无限试探文件系统。 */
const MAX_SEGMENT = 99;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 规划一次日志写入。
 *
 * 规则（与 spec 4.4 逐条对应）：
 * 1. `baseName` 默认 `nm-<本地 YYYYMMDD>`；
 * 2. 段 0 写满（`bytes + appendBytes > maxBytes`）依次试 `.1`…`.99`，取第一个
 *    不存在或未超限的段；超 99 退 `<hhmmss>`；
 * 3. 保留按 **mtime 降序**取最新 `keep` 份（不能按文件名字典序：`.` < `l`，
 *    会把基础文件排到分段文件之后），其余按 mtime 从旧到新进 `deleteNames`。
 */
// nm-style: keep-public — 三端文件 sink（mobile / desktop / CLI）共用同一份轮转策略，core 内部无消费者。
export function planLogFileWrite(input: {
  readonly now: Date;
  readonly existing: readonly LogFileEntry[];
  readonly appendBytes: number;
  /** 第一段文件名（不含 `.log`）；默认 `nm-<本地 YYYYMMDD>`。 */
  readonly baseName?: string;
  readonly maxBytes?: number;
  readonly keep?: number;
}): LogFilePlan {
  // 默认 baseName 取本地时间日期键：用户自己翻日志时要能对上手机时间（不用 UTC）。
  const baseName = input.baseName ?? `nm-${input.now.getFullYear()}${pad2(input.now.getMonth() + 1)}${pad2(input.now.getDate())}`;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = Math.max(1, input.keep ?? DEFAULT_KEEP);
  const byName = new Map(input.existing.map((entry) => [entry.name, entry]));

  let targetName: string | null = null;
  for (let segment = 0; segment <= MAX_SEGMENT; segment += 1) {
    const name = segment === 0 ? `${baseName}.log` : `${baseName}.${segment}.log`;
    const entry = byName.get(name);
    if (entry === undefined || entry.bytes + input.appendBytes <= maxBytes) {
      targetName = name;
      break;
    }
  }
  if (targetName == null) {
    targetName = `${baseName}.${pad2(input.now.getHours())}${pad2(input.now.getMinutes())}${pad2(input.now.getSeconds())}.log`;
  }

  const kept = [...input.existing].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name)).slice(0, keep);
  const keptNames = new Set(kept.map((entry) => entry.name));
  const deleteNames = input.existing
    .filter((entry) => !keptNames.has(entry.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
  return { targetName, deleteNames };
}
