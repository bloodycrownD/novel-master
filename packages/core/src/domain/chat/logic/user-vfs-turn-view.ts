/**
 * 用户 VFS UA 两段消息的识别与 UI 预览格式化。
 *
 * @module domain/chat/logic/user-vfs-turn-view
 */

import { messageBodyTextFromContent } from "../content/message-body-text.js";
import type { ToolResultBlock, ToolUseBlock } from "../model/content-block.js";
import type { ChatMessage } from "../model/message.js";
import { readMessageMetadata } from "../model/message-metadata.js";
import {
  actionXmlToToolUses,
  type DerivedToolUseInput,
} from "../../vfs/logic/action-xml-to-tool-uses.js";
import { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";

export { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";

export type ParsedUserVfsEditHunk = {
  readonly index: string;
  readonly old: string;
  readonly new: string;
};

export type ParsedUserVfsAction = {
  readonly kind: string;
  readonly path: string;
  readonly method?: string;
  readonly hunks: readonly ParsedUserVfsEditHunk[];
};

const USER_VFS_ACTION_RE =
  /<user-vfs-action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/user-vfs-action>)/g;
const EDIT_HUNK_RE =
  /<edit-hunk[^>]*index="(\d+)"[^>]*>[\s\S]*?<old>([\s\S]*?)<\/old>[\s\S]*?<new>([\s\S]*?)<\/new>[\s\S]*?<\/edit-hunk>/g;

function parseAttrs(attrs: string): Omit<ParsedUserVfsAction, "hunks"> {
  return {
    kind: attrs.match(/kind="([^"]+)"/)?.[1] ?? "",
    path: attrs.match(/path="([^"]+)"/)?.[1] ?? "",
    method: attrs.match(/method="([^"]+)"/)?.[1],
  };
}

function parseHunks(inner: string): ParsedUserVfsEditHunk[] {
  const hunks: ParsedUserVfsEditHunk[] = [];
  const hunkRe = new RegExp(EDIT_HUNK_RE.source, "g");
  let hm: RegExpExecArray | null;
  while ((hm = hunkRe.exec(inner)) !== null) {
    hunks.push({
      index: hm[1] ?? "",
      old: hm[2] ?? "",
      new: hm[3] ?? "",
    });
  }
  return hunks;
}

/** 解析文本中全部 `<user-vfs-action>`（burst flush 可含多条）。 */
export function parseAllUserVfsActionsFromText(
  text: string,
): readonly ParsedUserVfsAction[] {
  if (!text.includes("<user-vfs-action")) {
    return [];
  }
  const actions: ParsedUserVfsAction[] = [];
  const re = new RegExp(USER_VFS_ACTION_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    actions.push({ ...parseAttrs(attrs), hunks: parseHunks(inner) });
  }
  return actions;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatUserVfsActionXml(action: ParsedUserVfsAction): string {
  const attrs = [
    `kind="${escapeXmlAttr(action.kind)}"`,
    `path="${escapeXmlAttr(action.path)}"`,
  ];
  if (action.method) {
    attrs.push(`method="${escapeXmlAttr(action.method)}"`);
  }
  if (action.hunks.length === 0) {
    return `<user-vfs-action ${attrs.join(" ")} />`;
  }
  const inner = action.hunks
    .map(
      (hunk) =>
        `<edit-hunk index="${escapeXmlAttr(hunk.index)}"><old>${escapeXmlText(hunk.old)}</old><new>${escapeXmlText(hunk.new)}</new></edit-hunk>`,
    )
    .join("");
  return `<user-vfs-action ${attrs.join(" ")}>${inner}</user-vfs-action>`;
}

/**
 * 从已解析的 user-vfs-action 还原 flush 前的完整 tool input（用于 UI 展示）。
 */
export function deriveToolUsesFromVfsActions(
  actions: readonly ParsedUserVfsAction[],
): readonly DerivedToolUseInput[] {
  if (actions.length === 0) {
    return [];
  }
  const xml = actions.map(formatUserVfsActionXml).join("\n");
  return actionXmlToToolUses(xml);
}

function derivedToToolUseBlocks(
  derived: readonly DerivedToolUseInput[],
): ToolUseBlock[] {
  return derived.map((tu, index) => ({
    type: "tool_use" as const,
    id: `vfs-tu-${index}`,
    name: tu.name,
    input: tu.input,
  }));
}

function syntheticToolResults(toolUses: readonly ToolUseBlock[]): ToolResultBlock[] {
  return toolUses.map((tu) => ({
    type: "tool_result" as const,
    toolUseId: tu.id,
    content: "ok",
    ok: true,
  }));
}

function messageIsPlainTextOnly(message: ChatMessage): boolean {
  const blocks = message.content.blocks ?? [];
  return blocks.length > 0 && blocks.every((b) => b.type === "text");
}

function messageHasToolUse(message: ChatMessage): boolean {
  return (message.content.blocks ?? []).some((b) => b.type === "tool_use");
}

/** UA 两段在 messages 中的跨度（含首尾 message）。 */
export const USER_VFS_TURN_SPAN = 2 as const;

/**
 * 从 `startIndex` 起是否为完整的用户 VFS UA 两段（均未 hidden）。
 */
export function matchUserVfsTurnAt(
  messages: readonly ChatMessage[],
  startIndex: number,
): readonly [ChatMessage, ChatMessage] | null {
  const m0 = messages[startIndex];
  const m1 = messages[startIndex + 1];
  if (m0 == null || m1 == null) {
    return null;
  }
  if (m0.hidden || m1.hidden) {
    return null;
  }
  if (readMessageMetadata(m0.raw)?.kind !== "user_vfs_action") {
    return null;
  }
  const actionText = messageBodyTextFromContent(m0.content);
  if (!actionText.includes("<user-vfs-action")) {
    return null;
  }
  if (m1.role !== "assistant") {
    return null;
  }
  if (readMessageMetadata(m1.raw)?.kind !== "user_vfs_ack") {
    return null;
  }
  if (!messageIsPlainTextOnly(m1) || messageHasToolUse(m1)) {
    return null;
  }
  if (messageBodyTextFromContent(m1.content) !== USER_VFS_TURN_ACK_TEXT) {
    return null;
  }
  return [m0, m1];
}

export type UserVfsTurnView = {
  readonly id: string;
  readonly hidden: boolean;
  readonly actions: readonly ParsedUserVfsAction[];
  readonly toolUses: readonly ToolUseBlock[];
  readonly toolResults: readonly ToolResultBlock[];
  readonly bridgeText: string;
};

/** 从已匹配的 UA 两段构建 UI 视图。 */
export function buildUserVfsTurnView(
  turn: readonly [ChatMessage, ChatMessage],
): UserVfsTurnView {
  const [actionMsg, ackMsg] = turn;
  const actionText = messageBodyTextFromContent(actionMsg.content);
  const actions = parseAllUserVfsActionsFromText(actionText);
  const toolUses = derivedToToolUseBlocks(deriveToolUsesFromVfsActions(actions));
  return {
    id: actionMsg.id,
    hidden: actionMsg.hidden,
    actions,
    toolUses,
    toolResults: syntheticToolResults(toolUses),
    bridgeText: messageBodyTextFromContent(ackMsg.content),
  };
}

function formatActionLine(action: ParsedUserVfsAction): string {
  const base = `${action.kind} · ${action.path}`;
  if (action.method) {
    return `${base} (${action.method})`;
  }
  return base;
}

/** Real prompt / CLI 预览：单卡片正文。 */
export function formatUserVfsTurnPreviewBody(view: UserVfsTurnView): string {
  const lines: string[] = ["【用户 VFS 操作】"];
  if (view.actions.length > 0) {
    lines.push("", "操作：");
    for (const action of view.actions) {
      lines.push(`- ${formatActionLine(action)}`);
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
