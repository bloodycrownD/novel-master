/**
 * User VFS 发送前编排单入口（定案 A：materialize 并入 re-append merge）。
 *
 * runAgentTurn 在 append user 前调用本模块，保证：
 * - 空续跑（allowResumeWithoutInput）+ pending 时末条 user 经 delete → flush → re-append，
 *   merge = trailing∪flush∪attach∪materialize（workplace）写回末条 user
 * - 否则仅 flush pending → 返回 attachments 供 caller 并入新 append
 * - **不** insert UA / ack；attachments 不丢
 *
 * @module service/agent/logic/prepare-user-vfs-turn-for-agent-run
 */

import type {
  ChatMessage,
  MessageAttachment,
  MessageContent,
} from "@/domain/chat/model/message.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";

/** 空续跑时暂存的末条 user，flush 后写回以免丢附件 / U-U-A。 */
export interface TrailingUserSnapshot {
  readonly content: MessageContent;
  readonly raw: ChatMessage["raw"];
  readonly attachments?: readonly MessageAttachment[];
}

export interface PrepareUserVfsTurnForAgentRunInput {
  readonly messages: Pick<
    MessageService,
    "listBySession" | "delete" | "append"
  >;
  readonly userVfsTurn: UserVfsTurnService;
  readonly sessionId: string;
  /** 已 trim 的用户输入；空串表示空续跑。 */
  readonly trimmedInput: string;
  /**
   * 空续跑门闩：仅 `true` 时才 delete+re-append 末条 user。
   * 禁止「仅 attachments、非 resume」因 trimmed==="" 误删末条。
   */
  readonly allowResumeWithoutInput?: boolean;
  /**
   * Composer 附件（调用方应已清洗为 `source===attach`）；
   * 空续跑 re-append 时并入写回消息，避免丢 chip。
   */
  readonly composerAttachments?: readonly MessageAttachment[];
  /**
   * Core materialize 的 workplace 差集（定案 A）；
   * re-append 时与 flush/attach/trailing 同级 merge。
   */
  readonly workplaceAttachments?: readonly MessageAttachment[];
}

export interface PrepareUserVfsTurnForAgentRunResult {
  /** flush 是否产出了非空 user_ops。 */
  readonly flushed: boolean;
  /**
   * 供 caller 并入**新** append 的 attachments。
   * 若已在本函数内 re-append 末条，则为空（已合并进写回消息）。
   */
  readonly attachments: readonly MessageAttachment[];
  /** 空续跑重排后写回的 user 消息 id（供 checkpoint 锚定）。 */
  readonly reAppendedUserMessageId?: string;
}

/**
 * re-append merge：trailing∪flush∪attach∪materialize（剔除预览 user_ops）。
 */
function mergeAttachments(
  trailing: readonly MessageAttachment[] | undefined,
  flushed: readonly MessageAttachment[],
  composer?: readonly MessageAttachment[],
  workplace?: readonly MessageAttachment[],
): MessageAttachment[] | undefined {
  const composerAttachOnly = (composer ?? []).filter(
    (a) => a.source === "attach",
  );
  const workplaceOnly = (workplace ?? []).filter(
    (a) => a.source === "workplace",
  );
  const merged = [
    ...(trailing ?? []).filter((a) => a.source !== "user_ops"),
    ...flushed,
    ...composerAttachOnly,
    ...workplaceOnly,
  ];
  return merged.length > 0 ? merged : undefined;
}

/**
 * flush 前若 pending 非空、空续跑且允许 resume 且末条为 user，暂存并删除该条；
 * flush 后再 append 写回（含 attachments + materialize）。
 */
export async function prepareUserVfsTurnForAgentRun(
  input: PrepareUserVfsTurnForAgentRunInput,
): Promise<PrepareUserVfsTurnForAgentRunResult> {
  const {
    messages,
    userVfsTurn,
    sessionId,
    trimmedInput,
    allowResumeWithoutInput,
    composerAttachments,
    workplaceAttachments,
  } = input;

  let trailingUser: TrailingUserSnapshot | null = null;

  if (
    trimmedInput === "" &&
    allowResumeWithoutInput === true &&
    (await userVfsTurn.hasPendingTurns(sessionId))
  ) {
    const list = await messages.listBySession(sessionId);
    const last = list[list.length - 1];
    if (last?.role === "user") {
      trailingUser = {
        content: last.content,
        raw: last.raw,
        attachments: last.attachments,
      };
      await messages.delete(last.id);
    }
  }

  let flushedAttachments: readonly MessageAttachment[] = [];
  let flushed = false;
  let flushError: unknown;
  try {
    const flushResult = await userVfsTurn.flushPendingUserVfsTurns(sessionId);
    flushed = flushResult.flushed;
    flushedAttachments = flushResult.attachments;
  } catch (error: unknown) {
    flushError = error;
  }

  if (trailingUser != null) {
    const merged = mergeAttachments(
      trailingUser.attachments,
      flushedAttachments,
      composerAttachments,
      workplaceAttachments,
    );
    const reAppended = await messages.append(
      sessionId,
      "user",
      trailingUser.content,
      {
        raw: trailingUser.raw,
        ...(merged != null ? { attachments: merged } : {}),
      },
    );
    if (flushError != null) {
      throw flushError;
    }
    return {
      flushed,
      attachments: [],
      reAppendedUserMessageId: reAppended.id,
    };
  }

  if (flushError != null) {
    throw flushError;
  }
  return { flushed, attachments: flushedAttachments };
}
