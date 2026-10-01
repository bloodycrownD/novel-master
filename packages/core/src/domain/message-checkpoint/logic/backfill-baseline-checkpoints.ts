/**
 * 导入（角色卡 / ZIP）完成后，给「最后一个有 checkpoint 的消息之后」
 * 的空窗消息补一条 baseline checkpoint，指向当前工作区的 live file heads。
 *
 * 例如：消息 3 有 checkpoint，消息 6 时导入 → 只补 4、5、6。
 * 3 及之前不碰（它们已经有自己的 checkpoint 语义）。
 *
 * @module domain/message-checkpoint/logic/backfill-baseline-checkpoints
 */

import { listSessionFileHeads } from "./list-session-files.js";
import type { MessageCheckpointRepository } from "../repositories/message-checkpoint.port.js";
import type { MessageRepository } from "@/domain/chat/repositories/message.port.js";
import type { ChatMessageHeader } from "@/domain/chat/model/message.js";
import type { VfsEntryRepository } from "@/domain/vfs/repositories/vfs-entry.port.js";
import type { SessionKkvRepository } from "@/domain/session-kkv/repositories/session-kkv.port.js";
import {
  BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY,
  SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import type { IntegrityRepairOperation } from "@/service/integrity-repair.js";

/**
 * {@link backfillBaselineCheckpoints} 的执行结果。
 *
 * `confirmedNoGap` 表示「本次调用后可确认会话无空窗」：无 live 文件时无法
 * 建点也无法验证（不算确认），调用方据此决定是否写 backfill 游标。
 */
export interface BackfillBaselineResult {
  readonly confirmedNoGap: boolean;
}

/**
 * {@link scanBackfillGap} 的产出：**只读**的判定结果，尚未写任何行。
 *
 * `gapMessageIds` 是需要补 baseline 快照的消息 id（seq 升序）。
 * `filePointers` 是同一份 live head 指针快照，写阶段每条 checkpoint 共用。
 */
export interface BackfillScanResult {
  /** 无 live 文件 → false（无法建点也无法验证，不算「确认」）。 */
  readonly confirmedNoGap: boolean;
  readonly gapMessageIds: ReadonlyArray<string>;
  readonly filePointers: ReadonlyArray<{
    readonly entryId: number;
    readonly revisionVersion: number;
    readonly path: string;
  }>;
}

/**
 * 两段式短路判定的结论。
 *
 * - `short-circuit`：已确认无空窗，调用方无需跑全量扫描；`newCursor` 为可
 *   写入的游标值（`count == 游标` 分支与原值相同，可不写）。
 * - `full-scan`：判定不确定（游标缺失 / 矛盾态 / 删除可疑态 / 新增段缺口），
 *   调用方回退现有全量扫描逻辑；`count` 为判定时读到的消息总数，供全量
 *   跑完后补写游标。
 */
export type BackfillShortCircuitDecision =
  | {
      readonly kind: "short-circuit";
      readonly newCursor: number;
      readonly previousCursor: number;
    }
  | {
      readonly kind: "full-scan";
      readonly count: number;
    };

/**
 * backfill 两段式「无空窗」短路判定（只读，不写游标）。
 *
 * 前提是消息集只增不减（删除路径一律清游标兜底）：
 * - 第一段 O(1)：`countBySession` == 游标（当前消息总数恰等于上次确认无空窗
 *   时的总数）→ 短路；count < 游标即消息数减少、删除可疑态 → 回退全量。
 * - 第二段 O(新增段)：count > 游标时按 seq 升序圈出游标行数之后的新增段
 *   （`ORDER BY seq LIMIT -1 OFFSET 游标`，连续对话通常 2 条），段内做
 *   checkpoint 覆盖比对——覆盖口径与空窗语义严格等价：段内每条消息（含
 *   assistant）均有 checkpoint。相等 → 短路且游标前移至 count；不等（典型：
 *   上一轮纯文本对话尾部 assistant / tool-result user 无源头建点，属真实空窗）
 *   → 回退全量。
 * - 矛盾检测：游标 > 0 意味上次确认过无空窗、会话必有点，`hasAnyCheckpointForSession`
 *   为假即游标不可信 → 回退全量；游标缺失（未扫过或矛盾态）一律回退全量。
 *
 * 任何不确定都保守回退全量（宁误报勿漏报）。
 */
export async function decideBackfillShortCircuit(args: {
  readonly sessionKkv: SessionKkvRepository;
  readonly messageRepo: MessageRepository;
  readonly checkpointRepo: MessageCheckpointRepository;
  readonly sessionId: string;
}): Promise<BackfillShortCircuitDecision> {
  const { sessionKkv, messageRepo, checkpointRepo, sessionId } = args;

  const cursorEntry = await sessionKkv.get(
    sessionId,
    SESSION_KKV_DOMAIN_BACKFILL_CURSOR,
    BACKFILL_CURSOR_LAST_SCANNED_COUNT_KEY
  );
  let cursor: number | null = null;
  if (cursorEntry != null) {
    const parsed = Number.parseInt(cursorEntry.value, 10);
    cursor = Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  const count = await messageRepo.countBySession(sessionId);

  // 游标缺失即无短路资格（未扫过，或「会话有点却没游标」的矛盾态）——走全量。
  if (cursor == null) {
    return { kind: "full-scan", count };
  }

  // 矛盾检测：游标 > 0 意味上次确认过无空窗、会话必有点；hasAny=false 即游标不可信。
  if (cursor > 0) {
    const hasAny = await checkpointRepo.hasAnyCheckpointForSession(sessionId);
    if (!hasAny) {
      return { kind: "full-scan", count };
    }
  }

  // 第一段 O(1)：消息总数恰等于上次确认无空窗时的总数 → 短路 no-op。
  if (count === cursor) {
    return { kind: "short-circuit", newCursor: cursor, previousCursor: cursor };
  }

  // count < 游标：消息数只可能因删除而减少——删除可疑态，回退全量自愈。
  if (count < cursor) {
    return { kind: "full-scan", count };
  }

  // 第二段 O(新增段)：按 seq 升序圈出游标行数之后的新增段。
  const segment = await messageRepo.listBySessionOffset(sessionId, cursor);
  // 计数比对等价性依赖 message_checkpoint 每 (session_id, message_id) 至多一行
  // （insertCheckpoint 替换语义保证）：段内 checkpoint 行数 == 有 checkpoint 的消息数。
  const checkpointCount = await checkpointRepo.countCheckpointsForMessages(
    sessionId,
    segment.map((m) => m.id)
  );
  if (segment.length > 0 && checkpointCount === segment.length) {
    return { kind: "short-circuit", newCursor: count, previousCursor: cursor };
  }
  return { kind: "full-scan", count };
}

/**
 * 定位「首个空窗」的下标（`messages` 升序）。
 *
 * 单查询替代原先从尾部逐条 `hasCheckpoint` 的倒扫（最坏 M 次 SQL 往返，
 * 而这段每轮发送都跑）。`findIndex` 命中不了时按「整表都是空窗」兜底
 * （宁可多补不可漏补）。
 */
async function resolveFirstGapIndex(
  checkpointRepo: MessageCheckpointRepository,
  sessionId: string,
  messages: ReadonlyArray<ChatMessageHeader>
): Promise<number> {
  const lastCheckpointedId =
    await checkpointRepo.findLastCheckpointedMessageId(sessionId);
  if (lastCheckpointedId == null) {
    return 0;
  }
  const idx = messages.findIndex((m) => m.id === lastCheckpointedId);
  return idx + 1;
}

/**
 * 只读扫描段：定位空窗并取指针快照，**不写任何行**。
 *
 * 段与段之间没有锁（本仓单 `TdbcConnection` 串行化写，读可并发），所以这里
 * 允许读到一个稍旧的 head 快照——checkpoint 的语义本就是「某时刻的指针快照」，
 * 旧一版合法；写阶段会对空窗段做「连续前缀复核」闭合并发插点的 TOCTOU。
 */
export async function scanBackfillGap(args: {
  readonly entryRepo: VfsEntryRepository;
  readonly messageRepo: MessageRepository;
  readonly checkpointRepo: MessageCheckpointRepository;
  readonly projectId: string;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}): Promise<BackfillScanResult> {
  const { entryRepo, messageRepo, checkpointRepo, projectId, sessionId, signal } =
    args;
  const empty: BackfillScanResult = {
    confirmedNoGap: false,
    gapMessageIds: [],
    filePointers: [],
  };

  const files = await listSessionFileHeads(entryRepo, projectId, sessionId);
  if (files.length === 0) {
    return empty;
  }

  // 头投影（id/seq/role/hidden，不解压 content）：本函数只需要消息 id 与
  // 顺序，而 `listBySession` 会把**含 hidden** 的全会话正文逐条解压——它在
  // 每轮发送前都跑一次（run-agent-turn 的 backfill 阶段），大会话上正是
  // 「用户消息落库要等几秒」的主源（2026-09-30 实锤）。
  const messages = await messageRepo.listMessageHeadersBySession(sessionId);
  if (messages.length === 0) {
    // 空会话恒无空窗。
    return { confirmedNoGap: true, gapMessageIds: [], filePointers: [] };
  }

  // 弃权点（r3-run-4）：明确前移到定位空窗的那次单查询**之前**——
  // 「入场即 aborted ⇒ 零定位查询」这条性质不能被稀释。
  if (signal?.aborted === true) {
    return empty;
  }

  const firstGapIndex = await resolveFirstGapIndex(
    checkpointRepo,
    sessionId,
    messages
  );
  if (firstGapIndex >= messages.length) {
    // 无空窗：有文件、有消息、最后一个有 checkpoint 的消息之后没有缺口的。
    return {
      confirmedNoGap: true,
      gapMessageIds: [],
      filePointers: files.map((f) => ({
        entryId: f.entryId,
        revisionVersion: f.headVersion,
        path: f.logicalPath,
      })),
    };
  }

  return {
    confirmedNoGap: false,
    gapMessageIds: messages.slice(firstGapIndex).map((m) => m.id),
    filePointers: files.map((f) => ({
      entryId: f.entryId,
      revisionVersion: f.headVersion,
      path: f.logicalPath,
    })),
  };
}

/**
 * 写段：对扫描段算出的空窗段逐条补 baseline 快照。
 *
 * **连续前缀复核（TOCTOU 闭合）**：段 1 与段 2 之间可以有别的写插进来，
 * 典型是并发 `capture` 在空窗**中段**为某条消息建了点。gap 的起点若靠
 * 「最后一个 checkpointed id」单点收敛，那种情形下起点会后移 ⇒ 被跳过的
 * 消息**永久**进不了空窗段（RULE r3-run-4 关心的那一类永久缺口）。
 * ⇒ 这里从 gap 头开始逐条 `hasCheckpoint` 复核，**只在连续命中**时跳过，
 * 一旦遇到未命中就停下、之后全部照写 ⇒ 结构性免疫，且代价是 O(gap) 次读。
 */
export async function writeBackfillGap(args: {
  readonly checkpointRepo: MessageCheckpointRepository;
  readonly sessionId: string;
  readonly scan: BackfillScanResult;
  readonly signal?: AbortSignal;
}): Promise<BackfillBaselineResult> {
  const { checkpointRepo, sessionId, scan, signal } = args;
  const gap = scan.gapMessageIds;
  if (gap.length === 0) {
    return { confirmedNoGap: scan.confirmedNoGap };
  }

  // 连续前缀复核：跳过「本来就是点」的连续前缀，剩下照写。
  let start = 0;
  while (start < gap.length) {
    if (signal?.aborted === true) {
      return { confirmedNoGap: false };
    }
    const has = await checkpointRepo.hasCheckpoint(sessionId, gap[start]!);
    if (!has) {
      break;
    }
    start += 1;
  }

  const now = Date.now();
  for (let i = start; i < gap.length; i++) {
    // 弃权点（r3-run-4）：同款，提前退出。**中途退出保留已写部分是有意的**——
    // backfill 幂等（insertCheckpoint 不覆盖已有行），下轮补齐剩余空窗即可。
    if (signal?.aborted === true) {
      return { confirmedNoGap: false };
    }
    await checkpointRepo.insertCheckpoint({
      sessionId,
      messageId: gap[i]!,
      createdAtMs: now,
      files: scan.filePointers,
    });
  }
  // 补完即无空窗（空窗段全部 insertCheckpoint，其前的本就有 checkpoint）。
  return { confirmedNoGap: true };
}

/**
 * 从最后一个有 checkpoint 的消息之后，给所有空窗消息补 baseline 快照。
 *
 * - 已有 checkpoint 的消息不受影响（连续前缀复核只会跳过「本来就是点」的
 *   连续前缀，其余照写）。
 * - 如果会话里没有任何 checkpoint，则从第一条消息开始全部补。
 * - 没有任何 message 或没有任何 live 文件时是空操作（`confirmedNoGap=false`：
 *   无 live 文件时无法建点也无法验证空窗，不算「确认」）。
 * - r3-run-4：传 `signal` 时在扫描与补写前检查并提前退出，提前退出返回
 *   `confirmedNoGap: false`——**中断态绝不能被当成「确认无空窗」**，否则调用方
 *   会把游标写到 count，下一轮判定短路成「已确认」，剩下的空窗永远补不上。
 *   已 insert 的行随事务提交留下且不可覆盖（幂等），下轮接着补。
 */
export async function backfillBaselineCheckpoints(
  entryRepo: VfsEntryRepository,
  messageRepo: MessageRepository,
  checkpointRepo: MessageCheckpointRepository,
  projectId: string,
  sessionId: string,
  signal?: AbortSignal
): Promise<BackfillBaselineResult> {
  const scan = await scanBackfillGap({
    entryRepo,
    messageRepo,
    checkpointRepo,
    projectId,
    sessionId,
    signal,
  });
  return writeBackfillGap({ checkpointRepo, sessionId, scan, signal });
}

/**
 * 把 {@link backfillBaselineCheckpoints} 包成 `backfill` 类型的 {@link IntegrityRepairOperation}。
 *
 * detect 与 {@link backfillMissingBaselines} 同款两段式判定（只读不写游标）：
 * - 没 live 文件 → needsRepair=false；
 * - 两段式短路（游标相等 / 新增段覆盖比对通过）→ needsRepair=false；
 * - 其余回退「找空窗」逻辑（只读不写）：存在空窗 → needsRepair=true，
 *   details 给出空窗起止位置。
 *
 * repair 直接调用 {@link backfillBaselineCheckpoints}，幂等安全（已有 checkpoint
 * 不会被覆盖）；repair 不写游标——残留旧游标只导致下次判定保守回退，无正确性影响。
 */
export function createBaselineCheckpointBackfillOperation(args: {
  readonly entryRepo: VfsEntryRepository;
  readonly messageRepo: MessageRepository;
  readonly checkpointRepo: MessageCheckpointRepository;
  readonly sessionKkv: SessionKkvRepository;
  readonly projectId: string;
  readonly sessionId: string;
}): IntegrityRepairOperation {
  const { entryRepo, messageRepo, checkpointRepo, sessionKkv, projectId, sessionId } = args;
  return {
    name: `baseline-checkpoint-backfill:session=${sessionId}`,
    kind: "backfill",
    async detect() {
      const files = await listSessionFileHeads(entryRepo, projectId, sessionId);
      if (files.length === 0) {
        return { needsRepair: false };
      }
      // 两段式判定先行：短路即确认无空窗，无需全量找空窗。
      const decision = await decideBackfillShortCircuit({
        sessionKkv,
        messageRepo,
        checkpointRepo,
        sessionId,
      });
      if (decision.kind === "short-circuit") {
        return { needsRepair: false };
      }
      // 回退全量分支同样只要 id 与顺序：用头投影，避免为了「找最后一个有
      // checkpoint 的消息」把全会话正文解压一遍（见 backfillBaselineCheckpoints 注释）。
      const messages = await messageRepo.listMessageHeadersBySession(sessionId);
      if (messages.length === 0) {
        return { needsRepair: false };
      }
      const firstGapIndex = await resolveFirstGapIndex(
        checkpointRepo,
        sessionId,
        messages
      );
      if (firstGapIndex >= messages.length) {
        return { needsRepair: false };
      }
      return {
        needsRepair: true,
        details: `session=${sessionId} 在第 ${
          firstGapIndex + 1
        } 条消息处开始有空窗，共 ${
          messages.length - firstGapIndex
        } 条缺 baseline checkpoint`,
      };
    },
    async repair() {
      await backfillBaselineCheckpoints(
        entryRepo,
        messageRepo,
        checkpointRepo,
        projectId,
        sessionId
      );
    },
  };
}
