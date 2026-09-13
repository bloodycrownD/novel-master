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
 * 从最后一个有 checkpoint 的消息之后，给所有空窗消息补 baseline 快照。
 *
 * - 已有 checkpoint 的消息不受影响（不会被覆盖）。
 * - 如果会话里没有任何 checkpoint，则从第一条消息开始全部补。
 * - 没有任何 message 或没有任何 live 文件时是空操作（`confirmedNoGap=false`：
 *   无 live 文件时无法建点也无法验证空窗，不算「确认」）。
 */
export async function backfillBaselineCheckpoints(
  entryRepo: VfsEntryRepository,
  messageRepo: MessageRepository,
  checkpointRepo: MessageCheckpointRepository,
  projectId: string,
  sessionId: string
): Promise<BackfillBaselineResult> {
  const files = await listSessionFileHeads(entryRepo, projectId, sessionId);
  if (files.length === 0) {
    return { confirmedNoGap: false };
  }

  const messages = await messageRepo.listBySession(sessionId);
  if (messages.length === 0) {
    // 空会话恒无空窗。
    return { confirmedNoGap: true };
  }

  // 倒序找到最后一个有 checkpoint 的消息位置，它之后的都是需要补的空窗。
  // 如果没有任何 checkpoint，整个列表都是空窗（从头补）。
  let firstGapIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const has = await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id);
    if (has) {
      firstGapIndex = i + 1;
      break;
    }
  }

  if (firstGapIndex >= messages.length) {
    // 无空窗：有文件、有消息、最后一个有 checkpoint 的消息之后没有缺口的。
    return { confirmedNoGap: true };
  }

  const now = Date.now();
  const filePointers = files.map((f) => ({
    entryId: f.entryId,
    revisionVersion: f.headVersion,
  }));

  for (let i = firstGapIndex; i < messages.length; i++) {
    await checkpointRepo.insertCheckpoint({
      sessionId,
      messageId: messages[i]!.id,
      createdAtMs: now,
      files: filePointers,
    });
  }
  // 补完即无空窗（空窗段全部 insertCheckpoint，其前的本就有 checkpoint）。
  return { confirmedNoGap: true };
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
      const messages = await messageRepo.listBySession(sessionId);
      if (messages.length === 0) {
        return { needsRepair: false };
      }
      let firstGapIndex = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        const has = await checkpointRepo.hasCheckpoint(
          sessionId,
          messages[i]!.id
        );
        if (has) {
          firstGapIndex = i + 1;
          break;
        }
      }
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
