/**
 * 用户 VFS UA 两段消息的识别与 UI 预览格式化。
 *
 * @module domain/chat/logic/vfs-turn/user-vfs-turn-view
 */

import { messageBodyTextFromBlocks } from "../../content/message-body-text.js";
import { stringOrEmpty } from "@/common/coerce.js";
import type { ToolResultBlock, ToolUseBlock } from "../../model/content-block.js";
import type { ChatMessage } from "../../model/message.js";
import { readMessageMetadata } from "../../model/message-metadata.js";
import { actionXmlToToolUses, type DerivedToolUseInput } from "../../../vfs/logic/action-xml-to-tool-uses.js";
import { buildUserVfsActionXml, parseUserVfsActionsFromText } from "../../../vfs/logic/user-vfs-action-xml.js";
import { resolveRenameOrMoveAction } from "../message/status-chip-label.js";
import { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";

export { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";

/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export type ParsedUserVfsEditHunk = {
  readonly index: string;
  readonly old: string;
  readonly new: string;
};

/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export type ParsedUserVfsAction = {
  /** 操作名：write / edit / mkdir / delete / rename / move。 */
  readonly name: string;
  readonly path: string;
  readonly params: Record<string, unknown>;
  /** 与 name 对齐（UI 卡片仍读 kind）。 */
  readonly kind: string;
  readonly method?: string;
  readonly hunks: readonly ParsedUserVfsEditHunk[];
};

/** 解析文本中全部 `<action name="…">`。 */
export function parseAllUserVfsActionsFromText(text: string): readonly ParsedUserVfsAction[] {
  return parseUserVfsActionsFromText(text).map(({ name, params }) => {
    // 旧跨目录 rename XML → 规范为 move（只读兼容）。
    let resolvedName = name;
    if (name === "rename" || name === "move") {
      const from = stringOrEmpty(params.from);
      const to = stringOrEmpty(params.to);
      if (from !== "" && to !== "") {
        resolvedName = resolveRenameOrMoveAction(from, to);
      }
    }
    const path = resolvedName === "rename" || resolvedName === "move" ? `${stringOrEmpty(params.from)}→${stringOrEmpty(params.to)}` : stringOrEmpty(params.path);
    const hunks: ParsedUserVfsEditHunk[] = resolvedName === "edit" ? [{ index: "1", old: stringOrEmpty(params.oldString), new: stringOrEmpty(params.newString) }] : [];
    return {
      name: resolvedName,
      path,
      params,
      kind: resolvedName,
      method: resolvedName === "write" || resolvedName === "edit" ? resolvedName : undefined,
      hunks,
    };
  });
}

/**
 * 从已解析的 action 还原 flush 前的完整 tool input（用于 UI 展示）。
 */
/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export function deriveToolUsesFromVfsActions(actions: readonly ParsedUserVfsAction[]): readonly DerivedToolUseInput[] {
  if (actions.length === 0) {
    return [];
  }
  const xmlParts: string[] = [];
  for (const action of actions) {
    if (action.name === "edit" && action.hunks.length > 0) {
      xmlParts.push(action.hunks.map((hunk) => buildUserVfsActionXml("edit", { path: action.path, oldString: hunk.old, newString: hunk.new })).join("\n"));
      continue;
    }
    const [renameFrom = "", renameTo = ""] = action.path.split("→");
    const params = Object.keys(action.params).length > 0 ? action.params : action.name === "rename" || action.name === "move" ? { from: renameFrom, to: renameTo } : { path: action.path };
    xmlParts.push(buildUserVfsActionXml(action.name || action.kind, params));
  }
  return actionXmlToToolUses(xmlParts.join("\n"));
}

/** UA 两段在 messages 中的跨度（含首尾 message）。 */
/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export const USER_VFS_TURN_SPAN = 2 as const;

/**
 * 从 `startIndex` 起 UA 两段结构是否合法（不检查 hidden）。
 */
/** nm-style: keep-local — UA 结构校验是 matchUserVfsTurnAt 的单一判定阶段。 */
function matchUserVfsTurnStructureAt(messages: readonly ChatMessage[], startIndex: number): readonly [ChatMessage, ChatMessage] | null {
  const m0 = messages[startIndex];
  const m1 = messages[startIndex + 1];
  if (m0 == null || m1 == null) {
    return null;
  }
  if (readMessageMetadata(m0.raw)?.kind !== "user_vfs_action") {
    return null;
  }
  const actionText = messageBodyTextFromBlocks(m0.content.blocks);
  if (!actionText.includes("<action")) {
    return null;
  }
  if (m1.role !== "assistant") {
    return null;
  }
  if (readMessageMetadata(m1.raw)?.kind !== "user_vfs_ack") {
    return null;
  }
  const ackBlocks = m1.content.blocks ?? [];
  const hasNonText = ackBlocks.some((block) => block.type !== "text");
  const hasToolUse = ackBlocks.some((block) => block.type === "tool_use");
  if (ackBlocks.length === 0 || hasNonText || hasToolUse) {
    return null;
  }
  if (messageBodyTextFromBlocks(ackBlocks) !== USER_VFS_TURN_ACK_TEXT) {
    return null;
  }
  return [m0, m1];
}

/**
 * 从 `startIndex` 起是否为完整的用户 VFS UA 两段（均未 hidden）。
 * 用于 LLM 等相关路径；transcript 不再折叠为工具卡。
 */
/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export function matchUserVfsTurnAt(messages: readonly ChatMessage[], startIndex: number): readonly [ChatMessage, ChatMessage] | null {
  const turn = matchUserVfsTurnStructureAt(messages, startIndex);
  if (turn == null) {
    return null;
  }
  const [m0, m1] = turn;
  if (m0.hidden || m1.hidden) {
    return null;
  }
  return turn;
}

/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export type UserVfsTurnView = {
  readonly id: string;
  readonly hidden: boolean;
  readonly actions: readonly ParsedUserVfsAction[];
  readonly toolUses: readonly ToolUseBlock[];
  readonly toolResults: readonly ToolResultBlock[];
  readonly bridgeText: string;
};

/** 从已匹配的 UA 两段构建 UI 视图。 */
/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export function buildUserVfsTurnView(turn: readonly [ChatMessage, ChatMessage]): UserVfsTurnView {
  const [actionMsg, ackMsg] = turn;
  const actionText = messageBodyTextFromBlocks(actionMsg.content.blocks);
  const actions = parseAllUserVfsActionsFromText(actionText);
  const toolUses = deriveToolUsesFromVfsActions(actions).map((tu, index) => ({
    type: "tool_use" as const,
    id: `vfs-tu-${index}`,
    name: tu.name,
    input: tu.input,
  }));
  return {
    id: actionMsg.id,
    hidden: actionMsg.hidden || ackMsg.hidden,
    actions,
    toolUses,
    toolResults: toolUses.map((tu) => ({ type: "tool_result" as const, toolUseId: tu.id, content: "ok", ok: true })),
    bridgeText: messageBodyTextFromBlocks(ackMsg.content.blocks),
  };
}

/** Real prompt / CLI 预览：单卡片正文。 */
/** nm-style: keep-local — mobile test-utils/core-shim 与 webview bundle 消费。 */
export function formatUserVfsTurnPreviewBody(view: UserVfsTurnView): string {
  const lines: string[] = ["【用户 VFS 操作】"];
  if (view.actions.length > 0) {
    lines.push("", "操作：");
    for (const action of view.actions) {
      const label = action.name || action.kind;
      const base = `${label} · ${action.path}`;
      lines.push(`- ${action.method && action.method !== label ? `${base} (${action.method})` : base}`);
      for (const hunk of action.hunks) {
        lines.push(`  edit-hunk #${hunk.index}`);
        lines.push(`  old: ${hunk.old}`);
        lines.push(`  new: ${hunk.new}`);
      }
    }
  }
  if (view.toolUses.length > 0) {
    lines.push("", "工具：");
    for (let i = 0; i < view.toolUses.length; i++) {
      const tu = view.toolUses[i]!;
      const tr = view.toolResults[i];
      const status = tr?.ok === false ? "失败" : tr != null ? "成功" : "—";
      lines.push(`- ${tu.name} (${tu.id}) · ${status}`);
    }
  }
  if (view.bridgeText.trim() !== "") {
    lines.push("", view.bridgeText.trim());
  }
  return lines.join("\n");
}
