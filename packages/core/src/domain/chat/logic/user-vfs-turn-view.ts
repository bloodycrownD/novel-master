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
import { buildUserVfsActionXml } from "../../vfs/logic/user-vfs-save-mapping.js";
import { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";

export { USER_VFS_TURN_ACK_TEXT } from "./user-vfs-turn-constants.js";

export type ParsedUserVfsEditHunk = {
  readonly index: string;
  readonly old: string;
  readonly new: string;
};

export type ParsedUserVfsAction = {
  /** 操作名：write / edit / mkdir / delete / rename。 */
  readonly name: string;
  readonly path: string;
  readonly params: Record<string, unknown>;
  /** 与 name 对齐（UI 卡片仍读 kind）。 */
  readonly kind: string;
  readonly method?: string;
  readonly hunks: readonly ParsedUserVfsEditHunk[];
};

const ACTION_TAG_RE =
  /<action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/g;

function parseAttrs(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of attrs.matchAll(/(\w+)="([^"]*)"/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function parseJsonParams(inner: string): Record<string, unknown> {
  const raw = unescapeXml(inner).trim();
  if (raw === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function actionFromNamedTag(
  name: string,
  params: Record<string, unknown>,
): ParsedUserVfsAction {
  const path =
    name === "rename"
      ? `${asString(params.from)}→${asString(params.to)}`
      : asString(params.path);
  const hunks: ParsedUserVfsEditHunk[] =
    name === "edit"
      ? [
          {
            index: "1",
            old: asString(params.oldString),
            new: asString(params.newString),
          },
        ]
      : [];
  return {
    name,
    path,
    params,
    kind: name,
    method: name === "write" || name === "edit" ? name : undefined,
    hunks,
  };
}

/** 解析文本中全部 `<action name="…">`。 */
export function parseAllUserVfsActionsFromText(
  text: string,
): readonly ParsedUserVfsAction[] {
  if (!text.includes("<action")) {
    return [];
  }
  const actions: ParsedUserVfsAction[] = [];
  const re = new RegExp(ACTION_TAG_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const attrs = parseAttrs(match[1] ?? "");
    const name = attrs.name ?? "";
    if (name === "") {
      continue;
    }
    actions.push(actionFromNamedTag(name, parseJsonParams(match[2] ?? "")));
  }
  return actions;
}

function formatUserVfsActionXml(action: ParsedUserVfsAction): string {
  if (action.name === "edit" && action.hunks.length > 0) {
    return action.hunks
      .map((hunk) =>
        buildUserVfsActionXml("edit", {
          path: action.path,
          oldString: hunk.old,
          newString: hunk.new,
        }),
      )
      .join("\n");
  }
  const params =
    Object.keys(action.params).length > 0
      ? action.params
      : action.name === "rename"
        ? (() => {
            const [from = "", to = ""] = action.path.split("→");
            return { from, to };
          })()
        : { path: action.path };
  return buildUserVfsActionXml(action.name || action.kind, params);
}

/**
 * 从已解析的 action 还原 flush 前的完整 tool input（用于 UI 展示）。
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
 * 从 `startIndex` 起 UA 两段结构是否合法（不检查 hidden）。
 */
function matchUserVfsTurnStructureAt(
  messages: readonly ChatMessage[],
  startIndex: number,
): readonly [ChatMessage, ChatMessage] | null {
  const m0 = messages[startIndex];
  const m1 = messages[startIndex + 1];
  if (m0 == null || m1 == null) {
    return null;
  }
  if (readMessageMetadata(m0.raw)?.kind !== "user_vfs_action") {
    return null;
  }
  const actionText = messageBodyTextFromContent(m0.content);
  if (!actionText.includes("<action")) {
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

/**
 * 从 `startIndex` 起是否为完整的用户 VFS UA 两段（均未 hidden）。
 * 用于 LLM 等相关路径；transcript 不再折叠为工具卡。
 */
export function matchUserVfsTurnAt(
  messages: readonly ChatMessage[],
  startIndex: number,
): readonly [ChatMessage, ChatMessage] | null {
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
    hidden: actionMsg.hidden || ackMsg.hidden,
    actions,
    toolUses,
    toolResults: syntheticToolResults(toolUses),
    bridgeText: messageBodyTextFromContent(ackMsg.content),
  };
}

function formatActionLine(action: ParsedUserVfsAction): string {
  const label = action.name || action.kind;
  const base = `${label} · ${action.path}`;
  if (action.method && action.method !== label) {
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
