/**
 * VFS 非 head 历史版本混合打包任务（小组 zlib-concat / 大组 fossil 链，两张
 * pack 表 format 分派）。
 *
 * 骨架对齐 blob-binary-normalization（谓词驱动后台任务 + 单轮同步预算 +
 * KKV 兜底标记 + 收尾维护回调缝），**最大分叉是无终态完成标记**——VFS 版本
 * 持续增长，「打完」不是终态，每次入口重扫候选谓词（真库该查询毫秒级、
 * 115 组）；已生成的 pack 永不重写，新版本攒够下一组再打下一包。
 *
 * P1-1 零候选水位：谓词在稳态不返回候选 entry 也必须整表扫（真库打包态
 * 实测 121ms/轮），入口每次都付。「完整扫描收敛为候选=0 且 failedGroups=0」
 * 后把候选相关表的**廉价聚合指纹**（见 {@link matchesZeroCandidateWatermark}）
 * 记入 KKV；下一轮入口指纹一致即短路谓词（<10ms）。这是**自失效的负结果
 * 缓存，不是完成标记**：指纹是数据面纯函数，任何可能新增候选的变更都令它
 * 自失效——与上文「无终态标记」不冲突，谓词仍是唯一权威，水位只是「上一轮
 * 完整扫描为负 + 数据面未变」的快速通道。
 *
 * 候选谓词（SPEC binary-blob-and-vfs-pack Part B）：`vfs_revision.status=
 * 'active' AND content_hash IS NOT NULL`，且该 hash **仍是 blob 行**
 * （JOIN vfs_content_blob，打包删行后天然排除、谓词幂等）+ **未被任何
 * entry 作为 live head**（NOT EXISTS vfs_entry 引用，INV1：live head 必有
 * blob 行）。按 entry_id 分组、`COUNT(DISTINCT content_hash) >= 2` 才处理
 * （单 hash 无打包收益）；跨 entry 共享 hash 归首遇 entry（entry_id 升序
 * 首现者占有，member 主键一 hash 一行）。
 *
 * 分组与选型：组内按版本序（fossil 链相邻版本 delta 收益最大）；≤8 成员/
 * 组、≤1MB 明文/组（单成员超限则单独成组，容错）；流内重复明文（同组同
 * hash 多版本出现）只保留一份 member、多 revision 共享 (offset,length)；
 * 组内成员**平均明文** ≥ {@link FOSSIL_GROUP_PLAIN_THRESHOLD_BYTES}（24KB，
 * 真库阈值扫描实测最优档）走 fossil 链，否则 zlib-concat——两种布局的
 * 编码方向一律复用 pack-codec（段表布局只有那一份实现）。
 *
 * 每组单事务：**事务外**经 content store 读组内明文（三形态兼容，与归一
 * 任务交错安全——归一只改 encoding/bytes 形态不改明文）→ 选编码 → 事务内
 * INSERT pack + members + DELETE blob 行（原子，中断不留半打包态）。事务
 * 回调内不得引用外层 conn（AsyncMutex 不可重入，全部经 tx）。
 *
 * `member.compressed_byte_len` 恒为被替换 blob 行 `byte_len` 的**原样复制**
 * （两格式同口径）——fossil 组严禁记 delta 段长，否则按压缩侧折算的大文件
 * 闸门（findContentSizeByPath）会完全失真。
 *
 * 坏组（某成员明文解压失败）整组跳过、计入 `failedGroups`、不阻断其它组
 * 收敛；收尾校验「可归因的剩余候选 entry 数 > failedGroups」即
 * `stalled: true`（照骨架语义：谓词天然收敛，打转即异常——口径推导见
 * {@link runVfsContentPacking} 尾部注释，并发写入的归因豁免见同处）。
 * 坏组 blob 行原样保留，下轮入口重扫自然重试。
 *
 * @module infra/db-maintenance/impl/vfs-content-packing
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SqlValue } from "@/infra/tdbc/types.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import {
  encodeFossilChainPack,
  encodeZlibConcatPack,
  decodeFossilChainSpans,
  decodeZlibConcatSpans,
  VFS_PACK_FORMAT_FOSSIL_CHAIN_V1,
  VFS_PACK_FORMAT_ZLIB_CONCAT_V1,
  type VfsPackSpan,
} from "@/domain/vfs/content-store/logic/pack-codec.js";
import {
  asUint8Array,
  compressZlib,
  tightBytes,
  VFS_CONTENT_ENCODING_ZLIB,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import { SqliteKkvRepository } from "@/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import { runStartupMaintenanceOnce } from "./db-maintenance.service.js";

/** KKV 模块（两段式命名先例 `nm-blob-binary`；Step 11 三端接线消费）。 */
export const VFS_PACK_KKV_MODULE = "nm-vfs-pack";

/**
 * 收尾维护失败的补跑兜底标记 key（照 blob-binary 的 cr-01 方案 A：链路失败
 * 置 `"1"`，下次冷启动入口读到即无视「本轮是否有推进」强制补跑一次）。
 */
const STARTUP_MAINTENANCE_PENDING_KEY = "startupMaintenancePending";

/** 坏组数快照 key（UI 第三态「剩余 N 组（M 组需人工处理）」数据源）。 */
const FAILED_GROUPS_KEY = "failedGroups";

/**
 * 零候选水位 key（自失效负结果缓存；字段集与论证见
 * {@link matchesZeroCandidateWatermark}）。
 */
const ZERO_CANDIDATE_WATERMARK_KEY = "zeroCandidateWatermark";

/**
 * 编码选型阈值：组内成员平均明文 ≥ 24KB → fossil 链，否则 zlib-concat。
 *
 * @remarks 真库阈值扫描（16/24/32/48/64KB）实测 24KB 最优，16~32KB 区间
 * 平缓（总差 26KB）——阈值不脆，微调无风险。归因：平均明文 < 32KB 的组
 * deflate 整流上下文赢，≥ 32KB 的组 fossil 显式跨窗口匹配碾压。
 */
export const FOSSIL_GROUP_PLAIN_THRESHOLD_BYTES = 24 * 1024;

/** 每组成员数上限（spec 拍板 ≤8）。 */
const GROUP_MEMBER_LIMIT = 8;

/**
 * 每组明文累积上限（spec 拍板 ≤1MB；单成员超限容错单独成组）。
 *
 * 交叉引用（读侧闸门）：`pack-codec` 的 `FOSSIL_SEGMENT_TARGET_SIZE_LIMIT_BYTES`
 * 正是本常量——「超限单成员必独占一组 → 只落段 0、永不经 applyDelta」是不变量，
 * 故读侧可对 delta 声明的输出规模用同一阈值把死。**若这里放开单成员超限与他人
 * 同组，读侧常量必须同步放宽**，否则正常打包的 pack 会在读路径被误伤。
 */
const GROUP_PLAIN_BYTES_LIMIT = 1024 * 1024;

/** 单轮同步预算默认值（CLI 三任务串行最坏 60+60+30=150s；真库 Node 实测搬运全程 1.85s）。 */
export const DEFAULT_VFS_PACK_SYNC_BUDGET_MS = 30_000;

/** 候选成员（entry 内去重后的一份待打包 hash + blob 行 byte_len 原样值）。 */
interface VfsPackCandidateMember {
  readonly contentHash: string;
  /** 被替换 blob 行 `byte_len` 的原样复制（落 member.compressed_byte_len）。 */
  readonly byteLen: number;
}

/** 候选 entry（版本序去重后的成员序列；DISTINCT hash ≥ 2 才入选）。 */
interface VfsPackCandidateEntry {
  readonly entryId: number;
  readonly members: ReadonlyArray<VfsPackCandidateMember>;
  /**
   * 本 entry **谓词行**里的最大 `r.version`（含被跨 entry 去重/同 hash 去重
   * 剔除掉的行——「期间出现了新版本」这件事不能因为那行被去重就看不见）。
   *
   * @remarks 数据现成：谓词已 `SELECT r.version` 且按 version 升序。唯一用途
   * 是收尾 stalled 判据的并发归因（见 {@link runVfsContentPacking} 尾部注释）
   * ——「用户保存新版本」会把旧 head 的 hash 变成非 head 候选，收尾重扫里
   * 该 entry 的 maxVersion 必然变大，据此把它从「本轮该由我们负责却没收掉」
   * 的归因集里摘掉。
   */
  readonly maxVersion: number;
}

/** {@link runVfsContentPacking} 入参。 */
export interface RunVfsContentPackingOptions {
  /**
   * 同步预算（ms）。默认 30s；预算耗尽即返回（done=false），残余由调用方
   * 转后台再次调用（谓词重扫续跑）。
   */
  readonly syncBudgetMs?: number;
  /**
   * 组间守卫，按端取用组合（mobile: agent+maintenanceBusy；desktop:
   * agent+cloudSync+maintenanceBusy；cli 无守卫）。返回 true 时本轮暂停并
   * 立即返回 done=false。守卫由调用方传入，core 只留接口。
   */
  readonly shouldPause?: () => boolean;
  /**
   * 收尾维护链路（GC/checkpoint/VACUUM）即将开始的回调（app 层借它只包住
   * 真正的维护段——如 desktop 置维护 busy）。回调异常单独 try/catch、只 warn。
   */
  readonly beforeMaintenance?: () => void;
  /**
   * 收尾维护链路结束的复位回调（**finally 语义**：VACUUM 抛错也必须被调，
   * 否则 app 层 busy 标志永久挂死）。回调异常同样单独 try/catch、只 warn。
   */
  readonly afterMaintenance?: () => void;
}

/** {@link runVfsContentPacking} 结果。 */
export interface VfsContentPackRunResult {
  /** true = 本轮跑完收尾校验且无打转（剩余候选只剩坏组或已清空）。 */
  readonly done: boolean;
  /** 本次调用实际落库的 pack 组数（幂等重入的第二遍为 0）。 */
  readonly packedGroups: number;
  /** 本次调用被整组跳过的坏组数（某成员明文解压失败）。 */
  readonly failedGroups: number;
  /**
   * 收尾校验判定「可归因的剩余候选 entry 数 > failedGroups」（本轮本进程停手）。
   *
   * @remarks 可归因 = 「本轮开始时已存在且期间无新版本」的 entry（pbp-5 的
   * 并发豁免：期间被用户写入新增候选的 entry 不算本轮该负责却没收掉的）。
   * 成因与骨架同源：并发端抢写 / 组事务落库后谓词仍命中（打转）。
   * 处置一致：本进程停手、下个冷启动按谓词重扫，无正确性损失——已落库的
   * pack 不会回退。stalled 时 done=false、不写快照、不挂收尾维护。
   */
  readonly stalled: boolean;
}

/** {@link getVfsContentPackStatus} 结果。 */
export interface VfsContentPackStatus {
  /** 当前候选组数（entry 口径近似，见实现注释；UI「剩余 N 组」）。 */
  readonly pendingGroups: number;
  /** member 表总行数（已打包成员数）。 */
  readonly memberCount: number;
  /** pack 流字节总量（SUM(byte_len)）。 */
  readonly streamBytes: number;
  /** 上次收敛轮的坏组数快照（KKV；无快照为 0）。 */
  readonly failedGroups: number;
}

/** 单个 member 的校验失败明细。 */
export interface VfsPackVerifyFailure {
  readonly contentHash: string;
  readonly reason: string;
}

/** {@link verifyVfsContentPacks} 结果。 */
export interface VfsContentPackVerifyResult {
  /** 参与校验的 pack 组数（含全组解码失败的组）。 */
  readonly packCount: number;
  /** 参与校验的 member 行数。 */
  readonly memberCount: number;
  /** 校验失败明细（空数组 = 全部通过）。 */
  readonly failures: ReadonlyArray<VfsPackVerifyFailure>;
}

/** {@link unpackVfsContent} 结果。 */
export interface VfsContentUnpackResult {
  /** 本次展开的 pack 组数（含空 pack 的清理；重复执行的第二遍为 0）。 */
  readonly unpackedPacks: number;
  /** 本次物化回独立 blob 行的 member 数（INSERT OR IGNORE 跳过的不计）。 */
  readonly restoredRows: number;
}

/** 告警文案的错误摘要（Error 取 message，其余 String 化）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 批间让步：setTimeout(0) 交还事件循环（desktop main / RN JS 线程）。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// 候选谓词与分组（发现与收尾校验共用同一口径，保证判据可对账）
// ---------------------------------------------------------------------------

/**
 * 重扫候选 entry：active 非 head 历史版本、hash 仍是 blob 行、按 entry 分桶
 * 去重（版本序；跨 entry 共享 hash 归 entry_id 升序首遇者），DISTINCT hash
 * ≥ 2 才入选。
 *
 * @remarks 发现循环、收尾校验（{@link runVfsContentPacking} 尾部）、状态采样
 * （{@link getVfsContentPackStatus}）三处共用本函数——同一口径是 stalled
 * 判据「剩余候选 ≤ failedGroups」可对账的前提。
 *
 * @returns 每条带 `maxVersion`（该 entry 谓词行的最大版本号），供收尾并发
 *   归因用——见 {@link VfsPackCandidateEntry.maxVersion}。
 */
async function collectCandidateEntries(
  conn: TdbcConnection
): Promise<VfsPackCandidateEntry[]> {
  const rows = await conn.query<{
    entry_id: number;
    version: number;
    content_hash: string;
    byte_len: number;
  }>(
    `SELECT r.entry_id, r.version, r.content_hash, b.byte_len
     FROM vfs_revision r
     JOIN vfs_content_blob b ON b.content_hash = r.content_hash
     WHERE r.status = 'active'
       AND r.content_hash IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM vfs_entry e WHERE e.content_hash = r.content_hash)
     ORDER BY r.entry_id, r.version`
  );
  // 跨 entry 去重：entry_id 升序遍历（ORDER BY 保证），全局 Set 记已占有
  // hash，后遇 entry 的同 hash 剔除——member 主键一 hash 一行，共享 hash
  // 归首遇 entry 的组。
  const claimedHashes = new Set<string>();
  const entries: VfsPackCandidateEntry[] = [];
  let currentEntryId: number | null = null;
  let currentMembers: VfsPackCandidateMember[] = [];
  let currentMaxVersion = -1;
  const flush = (): void => {
    if (currentEntryId != null && new Set(currentMembers.map((m) => m.contentHash)).size >= 2) {
      entries.push({
        entryId: currentEntryId,
        members: currentMembers,
        maxVersion: currentMaxVersion,
      });
    }
  };
  for (const row of rows) {
    const entryId = Number(row.entry_id);
    if (entryId !== currentEntryId) {
      flush();
      currentEntryId = entryId;
      currentMembers = [];
      currentMaxVersion = -1;
    }
    // 版本水位在去重**之前**记账：被剔除的行同样代表「这个 entry 出现了这个
    // 版本」，漏记会让收尾归因把并发写入误当成「本轮没收干净」。
    const version = Number(row.version);
    if (version > currentMaxVersion) {
      currentMaxVersion = version;
    }
    const contentHash = String(row.content_hash);
    if (claimedHashes.has(contentHash)) {
      continue;
    }
    // entry 内同 hash 多版本（首现位置生效，后续版本共享同一 member 行）。
    if (currentMembers.some((m) => m.contentHash === contentHash)) {
      continue;
    }
    claimedHashes.add(contentHash);
    currentMembers.push({
      contentHash,
      byteLen: Number(row.byte_len),
    });
  }
  flush();
  return entries;
}

/**
 * 组内切分：按成员序累积，`≥8 成员` 或 `累积明文将超 1MB` 即切组；单成员
 * 明文本身超 1MB 时容错单独成组（否则该版本永远无法打包）。
 *
 * @param plainLengthOf 成员明文长度；坏成员（明文读取失败）以 blob 行
 *   `byte_len`（压缩长）占位——只影响切组边界近似，坏组本就整组跳过。
 */
function chunkCandidateGroups(
  members: ReadonlyArray<VfsPackCandidateMember>,
  plainLengthOf: (contentHash: string) => number
): VfsPackCandidateMember[][] {
  const groups: VfsPackCandidateMember[][] = [];
  let current: VfsPackCandidateMember[] = [];
  let currentBytes = 0;
  for (const member of members) {
    const length = plainLengthOf(member.contentHash);
    if (
      current.length > 0 &&
      (current.length >= GROUP_MEMBER_LIMIT ||
        currentBytes + length > GROUP_PLAIN_BYTES_LIMIT)
    ) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(member);
    currentBytes += length;
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// KKV：收尾维护兜底标记 + 坏组快照
// ---------------------------------------------------------------------------

/**
 * 读「收尾维护待补跑」兜底标记。读失败按「无标记」处理：KKV 读异常不能带
 * 崩打包主流程，兜底退化为「本轮不强制补跑」，无正确性损失。
 */
async function readStartupMaintenancePending(
  conn: TdbcConnection
): Promise<boolean> {
  try {
    const entry = await new SqliteKkvRepository(conn).get(
      VFS_PACK_KKV_MODULE,
      STARTUP_MAINTENANCE_PENDING_KEY
    );
    return entry != null;
  } catch (error) {
    console.warn(
      `[vfs-content-packing] 读 startupMaintenancePending 兜底标记失败，本轮按无标记处理：${errorText(error)}`
    );
    return false;
  }
}

/** 置「收尾维护待补跑」兜底标记（失败只 warn、不抛——照骨架）。 */
async function setStartupMaintenancePending(conn: TdbcConnection): Promise<void> {
  try {
    await new SqliteKkvRepository(conn).set(
      VFS_PACK_KKV_MODULE,
      STARTUP_MAINTENANCE_PENDING_KEY,
      "1"
    );
  } catch (error) {
    console.warn(
      `[vfs-content-packing] 置 startupMaintenancePending 兜底标记失败，放弃本次补跑兜底：${errorText(error)}`
    );
  }
}

/**
 * 清「收尾维护待补跑」兜底标记（补跑成功、且 `runStartupMaintenanceOnce`
 * 返回非 null 时调用；失败只 warn：最坏后果是下次冷启动多跑一次全库维护）。
 */
async function clearStartupMaintenancePending(
  conn: TdbcConnection
): Promise<void> {
  try {
    await new SqliteKkvRepository(conn).delete(
      VFS_PACK_KKV_MODULE,
      STARTUP_MAINTENANCE_PENDING_KEY
    );
  } catch (error) {
    console.warn(
      `[vfs-content-packing] 清 startupMaintenancePending 兜底标记失败，下次冷启动可能多跑一次维护：${errorText(error)}`
    );
  }
}

/**
 * 读坏组数快照（上次收敛轮的 failedGroups，UI 第三态数据源）。
 *
 * @remarks 值损坏（负数/小数/非 JSON）一律归 0 而不是透传——透传会让 UI
 * 渲染出 nonsense（口径照 blobBinary 的 ic-12）；无快照（从未跑过收敛轮）
 * 也为 0。
 */
async function readFailedGroupsSnapshot(
  conn: TdbcConnection
): Promise<number> {
  try {
    const entry = await new SqliteKkvRepository(conn).get(
      VFS_PACK_KKV_MODULE,
      FAILED_GROUPS_KEY
    );
    if (entry == null) {
      return 0;
    }
    const parsed = JSON.parse(entry.value) as { failedGroups?: unknown };
    return typeof parsed.failedGroups === "number" &&
      Number.isInteger(parsed.failedGroups) &&
      parsed.failedGroups >= 0
      ? parsed.failedGroups
      : 0;
  } catch {
    return 0;
  }
}

/**
 * 写坏组数快照（仅收敛轮调用：走到收尾校验且未 stalled；预算中途退出/
 * stalled 不写——半程计数会低估上一轮完整快照）。
 */
async function writeFailedGroupsSnapshot(
  conn: TdbcConnection,
  failedGroups: number
): Promise<void> {
  try {
    await new SqliteKkvRepository(conn).set(
      VFS_PACK_KKV_MODULE,
      FAILED_GROUPS_KEY,
      JSON.stringify({ at: new Date().toISOString(), failedGroups })
    );
  } catch (error) {
    console.warn(
      `[vfs-content-packing] 写 failedGroups 快照失败，状态行将沿用旧快照：${errorText(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// P1-1 零候选水位（自失效负结果缓存）
// ---------------------------------------------------------------------------

/**
 * 水位指纹：均取自候选相关表的廉价聚合 + entry 头部摘要。
 *
 * @remarks 不含时间戳——`at` 只是快照观测字段，比较时忽略。
 *
 * 【采样时序是水位正确性的前提】写水位的前提是「写下水位时观察到的数据面
 * = 零候选扫描所覆盖的数据面」。两次扫描与两次采样之间没有事务、没有快照，
 * 故采样必须**夹住**扫描：入口采 `fingerprintBefore`（在候选扫描**之前**）、
 * 收尾采 `fingerprintAfter`（在收尾扫描**之后**），两次一致才允许把
 * `fingerprintBefore` 落盘。反之（收尾扫描返回 0 之后才现采指纹）会把扫描
 * 与采样之间落下的新版本记成「已覆盖」——下轮入口指纹相等即短路谓词，
 * 那个候选便永远不进打包（pbp-3）。
 */
interface ZeroCandidateFingerprint {
  /** `COUNT(vfs_revision)`（revision 只有 INSERT/DELETE 变更面）。 */
  readonly revisionCount: number;
  /** `COUNT(vfs_entry)`。 */
  readonly entryCount: number;
  /** entry 行 `(entry_id, head_version, content_hash)` 有序序列的 sha256。 */
  readonly entryHeadDigest: string;
  /** `COUNT(vfs_content_blob)`。 */
  readonly blobCount: number;
  /** `COUNT(vfs_content_pack)`。 */
  readonly packCount: number;
  /** `COUNT(vfs_content_pack_member)`。 */
  readonly memberCount: number;
}

/** 指纹逐字段比较（只比六个字段，忽略快照里的 `at` 观测字段）。 */
function sameZeroCandidateFingerprint(
  a: ZeroCandidateFingerprint,
  b: ZeroCandidateFingerprint
): boolean {
  return (
    a.revisionCount === b.revisionCount &&
    a.entryCount === b.entryCount &&
    a.entryHeadDigest === b.entryHeadDigest &&
    a.blobCount === b.blobCount &&
    a.packCount === b.packCount &&
    a.memberCount === b.memberCount
  );
}

/**
 * 现场计算水位指纹。
 *
 * @remarks `entryHeadDigest` 是唯一需要读行的一步：按 `entry_id` 序把
 * `entry_id|head_version|content_hash` 逐行喂进 sha256。真库（599 entry /
 * 6.5k revision）实测亚毫秒级，相对谓词扫描（加索引后 68ms）可忽略；行数
 * 远小于 revision 规模（entry 是文件数、revision 是文件×版本数）。
 */
async function computeZeroCandidateFingerprint(
  conn: TdbcConnection
): Promise<ZeroCandidateFingerprint> {
  const aggregates = await conn.query<{
    revision_count: number;
    entry_count: number;
    blob_count: number;
    pack_count: number;
    member_count: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM vfs_revision) AS revision_count,
       (SELECT COUNT(*) FROM vfs_entry) AS entry_count,
       (SELECT COUNT(*) FROM vfs_content_blob) AS blob_count,
       (SELECT COUNT(*) FROM vfs_content_pack) AS pack_count,
       (SELECT COUNT(*) FROM vfs_content_pack_member) AS member_count`
  );
  const headRows = await conn.query<{
    entry_id: number;
    head_version: number;
    content_hash: string | null;
  }>(`SELECT entry_id, head_version, content_hash FROM vfs_entry ORDER BY entry_id`);
  const hasher = sha256.create();
  const encoder = new TextEncoder();
  for (const row of headRows) {
    hasher.update(
      encoder.encode(
        `${Number(row.entry_id)}|${Number(row.head_version)}|${
          row.content_hash ?? ""
        }\n`
      )
    );
  }
  return {
    revisionCount: Number(aggregates[0]?.revision_count ?? 0),
    entryCount: Number(aggregates[0]?.entry_count ?? 0),
    entryHeadDigest: bytesToHex(hasher.digest()),
    blobCount: Number(aggregates[0]?.blob_count ?? 0),
    packCount: Number(aggregates[0]?.pack_count ?? 0),
    memberCount: Number(aggregates[0]?.member_count ?? 0),
  };
}

/** 读水位快照；无快照/值损坏一律 null（等价「未命中」，回退完整扫描）。 */
async function readZeroCandidateWatermark(
  conn: TdbcConnection
): Promise<ZeroCandidateFingerprint | null> {
  try {
    const entry = await new SqliteKkvRepository(conn).get(
      VFS_PACK_KKV_MODULE,
      ZERO_CANDIDATE_WATERMARK_KEY
    );
    if (entry == null) {
      return null;
    }
    const parsed = JSON.parse(entry.value) as Partial<ZeroCandidateFingerprint>;
    const nonNegativeInt = (value: unknown): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 0;
    if (
      !nonNegativeInt(parsed.revisionCount) ||
      !nonNegativeInt(parsed.entryCount) ||
      typeof parsed.entryHeadDigest !== "string" ||
      parsed.entryHeadDigest.length === 0 ||
      !nonNegativeInt(parsed.blobCount) ||
      !nonNegativeInt(parsed.packCount) ||
      !nonNegativeInt(parsed.memberCount)
    ) {
      return null;
    }
    return {
      revisionCount: parsed.revisionCount,
      entryCount: parsed.entryCount,
      entryHeadDigest: parsed.entryHeadDigest,
      blobCount: parsed.blobCount,
      packCount: parsed.packCount,
      memberCount: parsed.memberCount,
    };
  } catch {
    return null;
  }
}

/**
 * 写零候选水位（**仅**在完整扫描收敛为「候选 entry=0 且 failedGroups=0」、
 * 且入口/收尾两次采样的指纹一致时调用）。
 *
 * @param fingerprint 入口扫描**之前**采到的指纹（`fingerprintBefore`）——函数
 *   内部不再重算。水位的前提是「写下水位时观察到的数据面 = 零候选扫描所覆盖
 *   的数据面」，故落笔的必须是扫描前那次采样；若在扫描/收尾之后才现采，扫描
 *   与采样之间落下的新版本会被误记成「已覆盖」（pbp-3 的 TOCTOU）。
 *
 * @remarks 写失败只 warn：最坏后果是下轮入口回退完整扫描，无正确性损失。
 */
async function writeZeroCandidateWatermark(
  conn: TdbcConnection,
  fingerprint: ZeroCandidateFingerprint
): Promise<void> {
  try {
    await new SqliteKkvRepository(conn).set(
      VFS_PACK_KKV_MODULE,
      ZERO_CANDIDATE_WATERMARK_KEY,
      JSON.stringify({ at: new Date().toISOString(), ...fingerprint })
    );
  } catch (error) {
    console.warn(
      `[vfs-content-packing] 写 zeroCandidateWatermark 水位失败，下轮入口回退完整扫描：${errorText(error)}`
    );
  }
}

/**
 * 清零候选水位（非收敛轮防御性清除：即使指纹论证有漏网，也不让水位跨过
 * 一次真扫描失败活下来）。失败只 warn。
 */
async function clearZeroCandidateWatermark(conn: TdbcConnection): Promise<void> {
  try {
    await new SqliteKkvRepository(conn).delete(
      VFS_PACK_KKV_MODULE,
      ZERO_CANDIDATE_WATERMARK_KEY
    );
  } catch (error) {
    console.warn(
      `[vfs-content-packing] 清 zeroCandidateWatermark 水位失败：${errorText(error)}`
    );
  }
}

/**
 * 命中零候选水位？（入口廉价查询；未命中/读失败一律回退完整谓词扫描）
 *
 * @remarks **这是自失效的负结果缓存，不是完成标记**：指纹是数据面的纯函数，
 * 一轮完整扫描收敛为「候选=0 且 failedGroups=0」后写入（写入前提还含「入口/
 * 收尾两次采样一致」，见 {@link ZeroCandidateFingerprint} 的采样时序说明）；
 * 任何新增候选的变更都令指纹自失效，与 spec「无终态完成标记」（入口重扫
 * 谓词）语义不冲突——谓词仍是唯一权威，水位只是「上一轮完整扫描的负结果
 * + 数据面未变」的短路。
 *
 * 字段集与「任何可能新增候选的变更都会改指纹」的逐项论证（候选谓词 =
 * `vfs_revision` active 非空 hash JOIN `vfs_content_blob` 仍存在 AND
 * `NOT EXISTS(vfs_entry.content_hash)`）：
 * - `revisionCount`：`vfs_revision` 只有 INSERT/DELETE 两条变更面（status 无
 *   原位 UPDATE——墓碑是 INSERT `status='deleted'`；`content_hash` 无 UPDATE
 *   写路径，触发器里的 `UPDATE OF content_hash` 只是防御；`ref_count` 的
 *   UPDATE 不参与候选判定）。任何 revision 增删都改计数。
 * - `entryCount`：entry 的 INSERT/DELETE（新建 / hardDelete / 复活重建）都改
 *   计数。
 * - `entryHeadDigest`：覆盖**只改头部不改任何计数**的路径——
 *   `resetHeadToVersion` 回滚到「目标 hash 已是 blob 行」的旧版本时 put 不新增
 *   blob、无新 revision、计数全不变，但旧 head hash 从此不再被任何 entry 引用
 *   （跨 entry 共享 hash 时会改变候选归属/凑组），是计数类字段的漏网面。
 * - `blobCount`：put 新内容 / put 抽回（member→blob）/ revision 触发器归零删行 /
 *   gc / unpack 都改计数。
 * - `packCount` / `memberCount`：打包落库（+pack +member −blob）、unpack、
 *   put 抽回删 member、gc 删孤儿 member 都改计数。
 * 残余面：revision 行 status/content_hash 的原位 UPDATE 与 blob 行
 * content_hash 改写——全仓无此写路径（vfs 各仓储 SQL 与触发器注释可查），
 * 故不设字段；若未来出现该写路径，必须补字段或改回每次全扫。
 */
async function matchesZeroCandidateWatermark(
  conn: TdbcConnection
): Promise<boolean> {
  const stored = await readZeroCandidateWatermark(conn);
  if (stored == null) {
    // 无水位时不付指纹计算（entryHeadDigest 要读 entry 全表）。
    return false;
  }
  try {
    const current = await computeZeroCandidateFingerprint(conn);
    return sameZeroCandidateFingerprint(stored, current);
  } catch (error) {
    console.warn(
      `[vfs-content-packing] 计算 zeroCandidateWatermark 指纹失败，本轮回退完整扫描：${errorText(error)}`
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// 单组打包（每组单事务）
// ---------------------------------------------------------------------------

/** 单组打包结果。 */
interface PackOneGroupResult {
  /** false = 空组收尾（全部成员已被别处收编，pack 行已删、无任何落库推进）。 */
  readonly packed: boolean;
  /** 实际收编的 member 行数（= pack 行最终 member_count）。 */
  readonly memberCount: number;
}

/**
 * 打包一组：选编码（组内平均明文 ≥ 24KB → fossil 链）→ 单事务 INSERT pack +
 * members + DELETE 被替换 blob 行。
 *
 * @remarks 事务回调内只经 tx（AsyncMutex 不可重入，引用外层 conn 会死锁）。
 * 事务抛错（库锁等）整体回滚后**上抛**——由调用方按端定失败策略（mobile/
 * desktop warn 收手、cli 裸抛），与骨架单行事务的行为口径一致。
 *
 * **member INSERT 的幂等等价物**（pbp-4）：骨架的幂等由「谓词进 WHERE」免费
 * 得到，打包把谓词搬到 JS 侧先读后写就丢了它——`content_hash` 是 member 主键，
 * 裸 INSERT 撞重复即抛穿整轮。可达路径：desktop rebootstrap 换连接时旧循环
 * continue 重取新 runtime、而调度已为新 runtime 起第二条循环，同连接两循环
 * 并发推进会采到同批候选；手工 unpack 与打包并发同理。故 INSERT 改
 * `ON CONFLICT(content_hash) DO NOTHING`，只有 `changes > 0`（真落库）的 hash
 * 进 `claimed`：blob 行的删除只对 claimed 生效（未收编的成员其权威副本不归
 * 本组处置），pack 行 `member_count` 也按 claimed.size 校正。
 *
 * **空组（claimed.size === 0）的处置**：显式 `DELETE FROM vfs_content_pack`
 * 后**正常提交**，用返回值把「空组」信号传出，而不是抛哨兵错。选它的硬约束是
 * 「不中断整轮任务」——`packOneGroup` 的事务异常在调用链上没有任何组级
 * catch，会一路抛穿 `runVfsContentPacking` 整轮（desktop/mobile 只在轮外
 * warn 收手、CLI 命令直接失败）；而空组不是坏数据、只是并发竞态，正确行为是
 * 「跳过该组继续」。同时**不能裸 return**：pack 行在 member INSERT 之前已插，
 * 裸 return 会提交一个零 member 的孤儿 pack 行（`verifyVfsContentPacks`
 * 把它的 memberCount 计入统计，`packRows()` 的 `member_count === 0` 会露馅）。
 */
async function packOneGroup(
  conn: TdbcConnection,
  entryId: number,
  group: ReadonlyArray<VfsPackCandidateMember>,
  plains: ReadonlyMap<string, Uint8Array>
): Promise<PackOneGroupResult> {
  const utf8s = group.map((member) => plains.get(member.contentHash)!);
  const totalPlain = utf8s.reduce((sum, plain) => sum + plain.byteLength, 0);
  const useFossil = totalPlain / utf8s.length >= FOSSIL_GROUP_PLAIN_THRESHOLD_BYTES;
  const encoded = useFossil
    ? encodeFossilChainPack(utf8s)
    : encodeZlibConcatPack(utf8s);
  const format = useFossil
    ? VFS_PACK_FORMAT_FOSSIL_CHAIN_V1
    : VFS_PACK_FORMAT_ZLIB_CONCAT_V1;

  return await conn.transaction<PackOneGroupResult>(async (tx) => {
    const inserted = await tx.execute(
      `INSERT INTO vfs_content_pack (entry_id, format, bytes, byte_len, member_count, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entryId,
        format,
        encoded.bytes,
        encoded.bytes.byteLength,
        utf8s.length,
        Date.now(),
      ]
    );
    const packId = Number(inserted.lastInsertRowid);
    const claimed: string[] = [];
    for (let index = 0; index < group.length; index++) {
      const member = group[index]!;
      // span 仍按**原 group 下标**取（编码产物不因收编结果重排）：ON CONFLICT
      // 命中的成员不产生 member 行，但 pack 字节流里的段布局不动。
      const span = encoded.spans[index]!;
      const memberInserted = await tx.execute(
        `INSERT INTO vfs_content_pack_member (content_hash, pack_id, offset, length, compressed_byte_len)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO NOTHING`,
        [
          member.contentHash,
          packId,
          span.offset,
          span.length,
          // 恒为被替换 blob 行 byte_len 的原样复制——fossil 组严禁记 delta 段长
          //（大文件闸门按压缩侧 4× 折算，记 delta 长会让超大文件被放行）。
          member.byteLen,
        ]
      );
      if (memberInserted.changes > 0) {
        claimed.push(member.contentHash);
      }
    }
      if (claimed.length === 0) {
      // 空组收尾：显式删掉刚插的 pack 行再正常提交（不得裸 return——那会留下
      // 零 member 的孤儿 pack 行）。信号经事务返回值传出，调用方计为跳过。
      await tx.execute(`DELETE FROM vfs_content_pack WHERE pack_id = ?`, [packId]);
      return { packed: false, memberCount: 0 };
    }
    // member_count 校正：INSERT 时按 utf8s.length 落的，ON CONFLICT 跳过的成员
    // 不产生行，必须按实际收编数改回来（否则 pack 行自述成员数与 member 行数
    // 对不上，verify 的 memberCount 统计与 UI 展示都失真）。
    await tx.execute(`UPDATE vfs_content_pack SET member_count = ? WHERE pack_id = ?`, [
      claimed.length,
      packId,
    ]);
    const placeholders = claimed.map(() => `?`).join(`,`);
    await tx.execute(
      `DELETE FROM vfs_content_blob WHERE content_hash IN (${placeholders})`,
      claimed
    );
    return { packed: true, memberCount: claimed.length };
  });
}

// ---------------------------------------------------------------------------
// 打包任务主入口
// ---------------------------------------------------------------------------

/**
 * 执行一轮候选谓词驱动的 VFS 非 head 历史版本打包。
 *
 * 无终态完成标记：每次入口重扫候选谓词，已打包 hash 因 blob 行被删而天然
 * 排除（谓词幂等）；预算耗尽 / 守卫暂停随时可停，重启续跑。
 *
 * P1-1：入口先查零候选水位（{@link matchesZeroCandidateWatermark}），命中
 * 即跳过谓词与收尾重扫；未命中走完整扫描，收敛为「候选=0 且坏组=0」时**在
 * 入口/收尾两次指纹一致的前提下**写水位、否则防御性清除（采样顺序见
 * {@link ZeroCandidateFingerprint} 与函数体的 pbp-3 注释）。维护补跑兜底标记
 * （startupMaintenancePending）在短路命中也生效。
 *
 * 收尾校验（stalled 判据的口径推导）：正常收敛下，每个仍未收敛的候选
 * entry 必含至少一个坏组（好组落库后 blob 行已删、该 entry 若无坏组则整
 * 体退出候选），故**剩余候选 entry 数 ≤ failedGroups** 是不变量；违反即
 * 「处理过却未收敛」的打转信号（事务落库不生效），本轮停手、不写快照、
 * 不挂收尾维护。**并发豁免（pbp-5）**：该推导只在「本轮没有新数据写入」时
 * 成立——用户保存新版本会把旧 head 的 hash 变成非 head 候选，收尾重扫里
 * 该 entry 的 `maxVersion` 必然变大。故判据只对「本轮开始时已存在（入口
 * 扫描见过）且期间无新版本（收尾 maxVersion 相等）」的 entry 生效，
 * `stalled = attributable.length > failedGroups`——否则一次保存就误判
 * 打转、连带跳过收尾 VACUUM（本轮删 blob 释放的页留在库里不还）。收尾
 * 校验直调 {@link collectCandidateEntries}（不走状态采样缓存，正确性不受
 * 3s 节流影响）。
 */
export async function runVfsContentPacking(
  conn: TdbcConnection,
  options: RunVfsContentPackingOptions = {}
): Promise<VfsContentPackRunResult> {
  const budgetMs = options.syncBudgetMs ?? DEFAULT_VFS_PACK_SYNC_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let packedGroups = 0;
  let failedGroups = 0;
  // 入口读维护失败兜底标记：读到则本轮强制走一次维护段（仍需 done）。
  const maintenancePending = await readStartupMaintenancePending(conn);
  // P1-1：零候选水位命中即跳过候选谓词的完整扫描（自失效负结果缓存，见
  // matchesZeroCandidateWatermark 的字段集论证）。维护兜底标记仍生效——
  // 命中且 pending 时走「空扫描 + 维护补跑段」，与完整扫描后的行为一致。
  const watermarkHit = await matchesZeroCandidateWatermark(conn);
  // pbp-3：入口指纹必须采在**候选扫描之前**（固定的入口顺序 = 水位查询 →
  // fingerprintBefore → 入口扫描）。水位的前提是「写下水位时观察到的数据面
  // = 零候选扫描所覆盖的数据面」；若在扫描之后再采，收尾扫描返回 0 与采样
  // 之间落下的新版本会被记成「已覆盖」，下轮入口指纹相等即短路谓词，那个候选
  // 便永远不进打包。水位命中时本轮不写不清水位、收尾整体沿用现状，故不必
  // 白采这一次指纹（matchesZeroCandidateWatermark 内部已经算过一次）。
  const fingerprintBefore = watermarkHit
    ? null
    : await computeZeroCandidateFingerprint(conn);

  const entries = watermarkHit ? [] : await collectCandidateEntries(conn);
  // 入口扫描的每 entry 版本水位（pbp-5 收尾归因的基准面）。
  const entryMaxVersionBefore = new Map<number, number>(
    entries.map((entry) => [entry.entryId, entry.maxVersion])
  );
  // 事务外经 content store 读明文（三形态兼容；blob 命中热路径零改动）。
  const store = new SqliteVfsContentStore(conn);
  const encoder = new TextEncoder();

  for (const entry of entries) {
    if (options.shouldPause?.()) {
      return { done: false, packedGroups, failedGroups, stalled: false };
    }

    // 读组内明文：坏成员（解压失败）记入 badHashes，整组跳过语义在切组后
    // 按组生效——不阻断同 entry 其它组、也不阻断其它 entry。
    const plains = new Map<string, Uint8Array>();
    const badHashes = new Set<string>();
    for (const member of entry.members) {
      try {
        plains.set(member.contentHash, encoder.encode(await store.get(member.contentHash)));
      } catch (error) {
        badHashes.add(member.contentHash);
        console.warn(
          `[vfs-content-packing] entry ${entry.entryId} 成员明文读取失败（content_hash=${member.contentHash}），所在组将整组跳过：${errorText(error)}`
        );
      }
    }

    const plainLengthOf = (contentHash: string): number => {
      const plain = plains.get(contentHash);
      if (plain != null) {
        return plain.byteLength;
      }
      // 坏成员以 blob 行 byte_len（压缩长）占位，仅影响切组边界近似。
      return (
        entry.members.find((m) => m.contentHash === contentHash)?.byteLen ?? 0
      );
    };
    const groups = chunkCandidateGroups(entry.members, plainLengthOf);
    for (const group of groups) {
      if (options.shouldPause?.()) {
        return { done: false, packedGroups, failedGroups, stalled: false };
      }
      if (group.some((member) => badHashes.has(member.contentHash))) {
        failedGroups += 1;
        continue;
      }
      const outcome = await packOneGroup(conn, entry.entryId, group, plains);
      if (outcome.packed) {
        packedGroups += 1;
      } else {
        // 空组（并发竞态：全组成员的 member 行已被别处收编，见 {@link
        // packOneGroup}）：不是坏数据、不该中断整轮，记整组跳过——成员保持可
        // 读（别处的 member 行或 blob 行都是权威副本），下轮入口重扫自然收敛。
        failedGroups += 1;
        console.warn(
          `[vfs-content-packing] entry ${entry.entryId} 所在组的 ${group.length} 个成员均已被别处收编（member 行已存在），本组跳过、不留孤儿 pack 行`
        );
      }
      // 预算检查放组粒度（单组事务已足够短；批间让步在 entry 粒度）。
      if (Date.now() >= deadline) {
        return { done: false, packedGroups, failedGroups, stalled: false };
      }
    }
    await yieldToEventLoop();
  }

  // ── 收尾校验（stalled 判定权；见函数头注释的口径推导）──────────────
  // 水位命中时跳过收尾重扫：零候选已由指纹背书（写入前提即「完整扫描后
  // 候选=0 且 failedGroups=0」）。
  const tailEntries = watermarkHit ? [] : await collectCandidateEntries(conn);
  const remaining = tailEntries.length;
  // pbp-5 并发归因：「剩余候选 ≤ failedGroups」的不变量只在「本轮没有新数据
  // 写入」时成立——一次保存就把旧 head 的 hash 变成非 head 候选，收尾重扫里
  // 该 entry 会新增候选、maxVersion 变大。判据只对「本轮开始时已存在且期间
  // 无新版本」的 entry 生效（before 有值且与收尾相等），把并发写入造成的
  // 剩余从归因集里摘掉，避免误判 stalled、连带跳过收尾 VACUUM（本轮删 blob
  // 释放的页就留在库里不还给文件系统）。
  const attributable = tailEntries.filter((tail) => {
    const before = entryMaxVersionBefore.get(tail.entryId);
    return before != null && tail.maxVersion === before;
  });
  const stalled = attributable.length > failedGroups;
  const done = !stalled;
  if (done) {
    // 坏组 blob 行原样保留、下轮入口重扫自然重试；快照只记收敛轮的计数。
    if (!watermarkHit) {
      await writeFailedGroupsSnapshot(conn, failedGroups);
      // 水位前置维持「tailEntries.length === 0」的全库口径（不按归因集收窄：
      // 并发写入造成的新候选下一轮仍需被发现，不能被水位短路掉）。
      if (remaining === 0 && failedGroups === 0) {
        // 完整扫描收敛为零候选：只有入口/收尾两次指纹一致才写水位——
        // 不一致说明零候选扫描与采样之间数据面动过（水位前提被打破），
        // 清水位让下一轮回退完整扫描，而不是把「有候选」钉成零候选水位。
        let fingerprintAfter: ZeroCandidateFingerprint | null = null;
        try {
          fingerprintAfter = await computeZeroCandidateFingerprint(conn);
        } catch (error) {
          console.warn(
            `[vfs-content-packing] 收尾重采 zeroCandidateWatermark 指纹失败，本轮清水位：${errorText(error)}`
          );
        }
        if (
          fingerprintBefore != null &&
          fingerprintAfter != null &&
          sameZeroCandidateFingerprint(fingerprintBefore, fingerprintAfter)
        ) {
          await writeZeroCandidateWatermark(conn, fingerprintBefore);
        } else {
          await clearZeroCandidateWatermark(conn);
        }
      } else {
        // 候选/坏组仍在：防御性清水位（水位与本次完整扫描的真相对不符时
        // 必须失效，宁保守不冒进）。
        await clearZeroCandidateWatermark(conn);
      }
    }
  } else {
    await clearZeroCandidateWatermark(conn);
    console.warn(
      `[vfs-content-packing] 收尾校验发现 ${attributable.length} 个可归因候选 entry 未收敛（本轮坏组仅 ${failedGroups}，收尾重扫剩余候选共 ${remaining}），疑似打转或并发抢写，本轮停手`
    );
  }

  if (done && (packedGroups > 0 || maintenancePending)) {
    // 删 blob 行释放的页挂 freelist，VACUUM 归还文件系统；仅本轮确有打包
    //（packedGroups > 0）或入口读到 pending 兜底标记才进维护段（稳态零成本）。
    try {
      try {
        options.beforeMaintenance?.();
      } catch (error) {
        console.warn(
          `[vfs-content-packing] beforeMaintenance 回调抛错，已忽略：${errorText(error)}`
        );
      }
      const result = await runStartupMaintenanceOnce(conn);
      if (result !== null) {
        // 仅在维护真跑过（返回非 null）时清兜底标记：同进程重入短路返回
        // null 时无条件清会让「标记被清、维护没跑」静默失效。
        await clearStartupMaintenancePending(conn);
      } else {
        console.warn(
          "[vfs-content-packing] 本进程已跑过收尾维护，startupMaintenancePending 保留待下次冷启动"
        );
      }
    } catch (error) {
      // 必须吞掉异常：VACUUM 在磁盘满/库被锁时会抛，调用方（CLI 启动链路
      // 等）没有 try/catch 兜底；失败只丢空间回收、不影响正确性。
      console.warn(
        `[vfs-content-packing] 收尾维护链路（缓存 GC / checkpoint / VACUUM）失败，不影响打包结果：${errorText(error)}`
      );
      await setStartupMaintenancePending(conn);
    } finally {
      // finally 语义：VACUUM 抛错也必须复位（app 层 busy 挂死更糟）。
      try {
        options.afterMaintenance?.();
      } catch (error) {
        console.warn(
          `[vfs-content-packing] afterMaintenance 回调抛错，已忽略：${errorText(error)}`
        );
      }
    }
  }
  return { done, packedGroups, failedGroups, stalled };
}

// ---------------------------------------------------------------------------
// 状态查询（3s 采样节流，照 blobBinary 私有 WeakMap 模式）
// ---------------------------------------------------------------------------

/**
 * 状态采样节流窗口：desktop 存储页 2s 轮询 × 候选谓词查询 = 迁移期 IO 放大，
 * 窗口内重复采样直接回放上次值（进度展示最多滞后一个窗口，无正确性影响）。
 * 取 3s 略大于 desktop 2s 轮询周期（mobile 5s 轮询每次仍真采样）。
 */
const STATUS_SAMPLING_THROTTLE_MS = 3000;

/**
 * 状态采样缓存（按连接实例隔离）。
 *
 * 与 blobBinary 的差别：本任务无终态标记、没有「免 COUNT 稳态快路径」——
 * 每次真采样都要跑候选谓词查询，故一律节流（稳态回放 3s 内的零候选值，
 * 同样只是进度展示滞后）。runVfsContentPacking 的完成判定与收尾校验不走
 * 本缓存（直调 collectCandidateEntries）。
 */
let statusSamplingThrottleCache = new WeakMap<
  TdbcConnection,
  { at: number; value: VfsContentPackStatus }
>();

/**
 * 测试专用：清空状态采样节流缓存（WeakMap 无清空 API，直接换新实例）。
 *
 * @remarks 共享连接的测试用例之间必须调用，否则前序用例的采样会在 3s 窗口
 * 内串值（生产代码不得调用）。
 */
export function __resetVfsPackStatusSamplingThrottleForTests(): void {
  statusSamplingThrottleCache = new WeakMap();
}

/**
 * 采样打包状态（存储页状态行 + 调度侧零成本判定共用）。
 *
 * `pendingGroups` 为 entry 口径（DISTINCT hash ≥ 2 的候选 entry 数）：组切
 * 分依赖明文长度（须读明文后才能精确），状态采样不搬明文——entry 数是组
 * 数的确定性下界（真库 155 组 / 150 entry，近似度足够 UI「剩余 N 组」）。
 */
export async function getVfsContentPackStatus(
  conn: TdbcConnection
): Promise<VfsContentPackStatus> {
  const cached = statusSamplingThrottleCache.get(conn);
  if (cached != null && Date.now() - cached.at < STATUS_SAMPLING_THROTTLE_MS) {
    return cached.value;
  }
  // P1-1：水位命中 → 候选谓词短路（pendingGroups 恒 0，memberCount/streamBytes
  // 仍真采样；短路只省谓词，不改状态语义）。
  const watermarkHit = await matchesZeroCandidateWatermark(conn);
  const [pendingGroups, aggregates] = await Promise.all([
    watermarkHit
      ? Promise.resolve(0)
      : collectCandidateEntries(conn).then((entries) => entries.length),
    conn.query<{ member_count: number; stream_bytes: number }>(
      `SELECT
         (SELECT COUNT(*) FROM vfs_content_pack_member) AS member_count,
         (SELECT COALESCE(SUM(byte_len), 0) FROM vfs_content_pack) AS stream_bytes`
    ),
  ]);
  const status: VfsContentPackStatus = {
    pendingGroups,
    memberCount: Number(aggregates[0]?.member_count ?? 0),
    streamBytes: Number(aggregates[0]?.stream_bytes ?? 0),
    failedGroups: await readFailedGroupsSnapshot(conn),
  };
  statusSamplingThrottleCache.set(conn, { at: Date.now(), value: status });
  return status;
}

// ---------------------------------------------------------------------------
// 完整性校验（应急回滚前的自检）
// ---------------------------------------------------------------------------

/** 按 pack format 分派成员解码（verify 与 unpack 共用；未知 format 抛错）。 */
function decodePackMembersByFormat(
  format: string,
  packBytes: Uint8Array,
  spans: ReadonlyArray<VfsPackSpan>
): Uint8Array[] {
  if (format === VFS_PACK_FORMAT_ZLIB_CONCAT_V1) {
    return decodeZlibConcatSpans(packBytes, spans);
  }
  if (format === VFS_PACK_FORMAT_FOSSIL_CHAIN_V1) {
    return decodeFossilChainSpans(packBytes, spans);
  }
  throw new Error(`不支持的 vfs_content_pack.format: ${format}`);
}

/**
 * 逐 member 校验 pack 自包含性：pack 组切片明文 hash == content_hash；
 * fossil 组沿链 apply 后 hash == content_hash。
 *
 * @remarks 不写库、可随时跑；组级解码失败（段表损坏/区间越界）把该组全部
 * member 记入 failures 而不是抛穿——调用方（应急回滚前的自检）需要完整
 * 明细而不是第一个错。
 */
export async function verifyVfsContentPacks(
  conn: TdbcConnection
): Promise<VfsContentPackVerifyResult> {
  const packRows = await conn.query<{
    pack_id: number;
    format: string;
    bytes: SqlValue;
  }>(`SELECT pack_id, format, bytes FROM vfs_content_pack ORDER BY pack_id`);
  const failures: VfsPackVerifyFailure[] = [];
  let memberCount = 0;
  for (const pack of packRows) {
    const memberRows = await conn.query<{
      content_hash: string;
      offset: number;
      length: number;
    }>(
      `SELECT content_hash, offset, length FROM vfs_content_pack_member
       WHERE pack_id = ? ORDER BY content_hash`,
      [pack.pack_id]
    );
    memberCount += memberRows.length;
    if (memberRows.length === 0) {
      continue;
    }
    let plains: Uint8Array[];
    try {
      plains = decodePackMembersByFormat(String(pack.format), asUint8Array(pack.bytes, "vfs_content_pack.bytes"), memberRows.map((row) => ({
        offset: Number(row.offset),
        length: Number(row.length),
      })));
    } catch (error) {
      for (const row of memberRows) {
        failures.push({
          contentHash: String(row.content_hash),
          reason: `组解码失败: ${errorText(error)}`,
        });
      }
      continue;
    }
    memberRows.forEach((row, index) => {
      // hash 对还原明文字节直算（与 hashContent(string) 等价：其内部即
      // TextEncoder 编码后 sha256），不依赖字符串往返。
      const actual = bytesToHex(sha256(plains[index]!));
      if (actual !== String(row.content_hash)) {
        failures.push({
          contentHash: String(row.content_hash),
          reason: `还原明文 hash ${actual} != member.content_hash`,
        });
      }
    });
  }
  return { packCount: packRows.length, memberCount, failures };
}

// ---------------------------------------------------------------------------
// 反向展开（应急回滚）
// ---------------------------------------------------------------------------

/**
 * 反向展开全部 pack：逐 pack 单事务「先写后删」——物化独立 blob 行
 * （`INSERT OR IGNORE`，重复执行安全）→ 删 member → 删 pack。
 *
 * **ref_count 现场重算**（T-VP16 锁定）：blob 行的 ref_count 只由 revision
 * 触发器维护，unpack 直接 INSERT 绕过触发器，故 ref_count =
 * `COUNT(vfs_revision WHERE content_hash = ?)` 现场算出——否则后续 revision
 * 删除触发器按错误基数递减、要么提前归零误删、要么永不归零泄漏。
 *
 * blob 行形态统一重写为 `zlib` + 二进制 + 重算 `byte_len`（压缩字节物理
 * 长度；member.compressed_byte_len 是原行快照，重压缩可能差几个字节，
 * byte_len 恒以本行 bytes 的物理长度为准）。已存在的 blob 行（put 抽回等）
 * 不覆盖：内容寻址等值，ref_count 由事务末的幂等重算 UPDATE 统一校正
 * （`INSERT OR IGNORE` 命中既有行时不写 ref_count，那条路单靠触发器口径救不回来）。
 */
export async function unpackVfsContent(
  conn: TdbcConnection
): Promise<VfsContentUnpackResult> {
  const packRows = await conn.query<{
    pack_id: number;
    format: string;
    bytes: SqlValue;
  }>(`SELECT pack_id, format, bytes FROM vfs_content_pack ORDER BY pack_id`);
  let unpackedPacks = 0;
  let restoredRows = 0;
  for (const pack of packRows) {
    const memberRows = await conn.query<{
      content_hash: string;
      offset: number;
      length: number;
    }>(
      `SELECT content_hash, offset, length FROM vfs_content_pack_member
       WHERE pack_id = ? ORDER BY content_hash`,
      [pack.pack_id]
    );
    // 解码在事务外（纯计算，不经 conn）；空 pack（put 抽回后的死区）直接
    // 进事务清理，无 member 可物化。
    let plains: Uint8Array[] = [];
    if (memberRows.length > 0) {
      plains = decodePackMembersByFormat(
        String(pack.format),
        asUint8Array(pack.bytes, "vfs_content_pack.bytes"),
        memberRows.map((row) => ({
          offset: Number(row.offset),
          length: Number(row.length),
        }))
      );
    }
    const packId = Number(pack.pack_id);
    await conn.transaction(async (tx) => {
      for (let index = 0; index < memberRows.length; index++) {
        const contentHash = String(memberRows[index]!.content_hash);
        const compressed = tightBytes(compressZlib(plains[index]!));
        const inserted = await tx.execute(
          `INSERT OR IGNORE INTO vfs_content_blob (content_hash, encoding, bytes, byte_len, ref_count)
           VALUES (?, ?, ?, ?,
             (SELECT COUNT(*) FROM vfs_revision WHERE content_hash = ?))`,
          [
            contentHash,
            VFS_CONTENT_ENCODING_ZLIB,
            compressed,
            compressed.byteLength,
            contentHash,
          ]
        );
        if (inserted.changes > 0) {
          restoredRows += 1;
        }
      }
      // 先写后删的收尾：member 先删（member 引用 pack），pack 最后删——
      // 同一事务内原子，中断（回滚）即回到展开前形态，可重复执行。
      await tx.execute(
        `DELETE FROM vfs_content_pack_member WHERE pack_id = ?`,
        [packId]
      );
      // 幂等 ref_count 修复：上一步的 INSERT OR IGNORE 只对本函数**自己新建**的
      // blob 行算过 ref_count；命中既有行（put 抽回残留、或历史 bug 落下的
      // ref_count=0 残行）时静默跳过，那些行的计数仍是错的——后续删引用会撞
      // CHECK(ref_count >= 0)，无 CHECK 时会误删仍被引用的 blob 行。对本 pack 的
      // 全部成员 hash 统一重算一遍，天然幂等（值已对时写入同值）。
      if (memberRows.length > 0) {
        const placeholders = memberRows.map(() => `?`).join(`,`);
        await tx.execute(
          `UPDATE vfs_content_blob SET ref_count = (
             SELECT COUNT(*) FROM vfs_revision r
             WHERE r.content_hash = vfs_content_blob.content_hash
           )
           WHERE content_hash IN (${placeholders})`,
          memberRows.map((row) => String(row.content_hash))
        );
      }
      await tx.execute(`DELETE FROM vfs_content_pack WHERE pack_id = ?`, [
        packId,
      ]);
    });
    unpackedPacks += 1;
  }
  return { unpackedPacks, restoredRows };
}
