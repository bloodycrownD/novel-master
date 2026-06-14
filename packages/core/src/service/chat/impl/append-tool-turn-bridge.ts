/**
 * Agent maxSteps 截断后用户确认的桥接 assistant 追加。
 *
 * @module service/chat/impl/append-tool-turn-bridge
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { MessageService } from "../message.port.js";
import type { AppendToolTurnBridgeFn } from "../user-vfs-turn.port.js";

/** 桥接 assistant 固定文案。 */
export const TOOL_TURN_BRIDGE_TEXT = "【done】";

/**
 * 创建 `appendToolTurnBridge(sessionId)` 闭包。
 */
export function createAppendToolTurnBridge(
  messages: MessageService,
): AppendToolTurnBridgeFn {
  return async (sessionId: string): Promise<ChatMessage> => {
    return messages.append(
      sessionId,
      "assistant",
      { blocks: [{ type: "text", text: TOOL_TURN_BRIDGE_TEXT }] },
      {
        raw: {
          metadata: {
            synthetic: true,
            kind: "tool_turn_bridge",
          },
        },
      },
    );
  };
}
