/**
 * User VFS 发送前编排单入口（接线图 B）。
 *
 * runAgentTurn 在 append user 前调用本模块，保证：
 * - 空续跑 + pending 时末条 user 经 delete → flush → re-append，避免 U-U-A
 * - 否则仅 flush pending turns（含 synthetic user_vfs_action + user_vfs_ack）
 * - checkpoint 锚在 action 行（事务外 capture 语义由 flush 服务保持）
 *
 * @module service/agent/logic/prepare-user-vfs-turn-for-agent-run
 */

import type {
  ChatMessage,
  MessageContent,
} from "@/domain/chat/model/message.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { UserVfsTurnService } from "@/service/chat/user-vfs-turn.port.js";

/** 空续跑时暂存的末条 user，flush 后写回以免 U-U-A。 */
export interface TrailingUserSnapshot {
  readonly content: MessageContent;
  readonly raw: ChatMessage["raw"];
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
}

/**
 * flush 前若 pending 非空、空续跑且末条为 user，暂存并删除该条；flush 后再 append 写回。
 * pending 为空时 flush 为 no-op，不重排末条 user。
 */
export async function prepareUserVfsTurnForAgentRun(
  input: PrepareUserVfsTurnForAgentRunInput,
): Promise<void> {
  const { messages, userVfsTurn, sessionId, trimmedInput } = input;

  let trailingUser: TrailingUserSnapshot | null = null;

  // 仅 pending 非空且空续跑：末条 user 须在 flush UA 之后重挂，避免 U-U-A。
  if (
    trimmedInput === "" &&
    (await userVfsTurn.hasPendingTurns(sessionId))
  ) {
    const list = await messages.listBySession(sessionId);
    const last = list[list.length - 1];
    if (last?.role === "user") {
      trailingUser = { content: last.content, raw: last.raw };
      await messages.delete(last.id);
    }
  }

  try {
    await userVfsTurn.flushPendingUserVfsTurns(sessionId);
  } finally {
    if (trailingUser != null) {
      await messages.append(sessionId, "user", trailingUser.content, {
        raw: trailingUser.raw,
      });
    }
  }
}
