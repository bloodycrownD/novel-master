/**
 * Undo Send：从消息 `user_ops` 附件映回操作日志（每附件一条；annotate 跳过）。
 * 同一附件 XML 内多段 edit 合并进该条 `hunks`。旧合成 XML 尽力解析，损坏条跳过。
 *
 * @module domain/chat/logic/parse-user-ops-log-from-attachments
 */

import type { MessageAttachment } from "../model/message-attachment.schema.js";
import type {
  UserOpsLogEntry,
  UserOpsLogHunk,
} from "../model/user-ops-log.schema.js";
import { parseAllUserVfsActionsFromText } from "./user-vfs-turn-view.js";

function mintUserOpsLogId(): string {
  return `uol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * 从消息 attachments 解析可 Undo 映回的手改日志。
 * 仅非 annotate 的 `source:user_ops`；每条附件 → 至多一条 log。
 */
export function parseUserOpsLogFromAttachments(
  attachments: readonly MessageAttachment[] | null | undefined,
): UserOpsLogEntry[] {
  if (attachments == null || attachments.length === 0) {
    return [];
  }

  const out: UserOpsLogEntry[] = [];
  const createdAtMs = Date.now();

  for (const att of attachments) {
    if (att.source !== "user_ops") {
      continue;
    }
    if (att.action === "annotate") {
      continue;
    }
    const xml =
      typeof att.content === "string" && att.content.trim() !== ""
        ? att.content
        : null;
    if (xml == null) {
      continue;
    }

    try {
      const actions = parseAllUserVfsActionsFromText(xml);
      const handOps = actions.filter(
        (a) =>
          a.name === "write" ||
          a.name === "edit" ||
          a.name === "mkdir" ||
          a.name === "delete" ||
          a.name === "rename",
      );
      if (handOps.length === 0) {
        continue;
      }

      const edits = handOps.filter((a) => a.name === "edit");
      if (edits.length === handOps.length && edits.length > 0) {
        const path =
          (typeof att.path === "string" && att.path !== ""
            ? att.path
            : edits[0]!.path) || edits[0]!.path;
        const hunks: UserOpsLogHunk[] = edits.map((a) => ({
          oldString: a.hunks[0]?.old ?? asString(a.params.oldString),
          newString: a.hunks[0]?.new ?? asString(a.params.newString),
        }));
        out.push({
          id: mintUserOpsLogId(),
          createdAtMs,
          actionXml: xml.trim(),
          action: "edit",
          path,
          hunks,
        });
        continue;
      }

      // 旧合成 / 单 action：取首个非 edit 主导；若首条是 write 等
      const head = handOps[0]!;
      if (head.name === "edit") {
        // 混有非 edit 时仍以首条 edit 为主不常见；合并全部 edit hunks
        const path =
          typeof att.path === "string" && att.path !== ""
            ? att.path
            : head.path;
        out.push({
          id: mintUserOpsLogId(),
          createdAtMs,
          actionXml: xml.trim(),
          action: "edit",
          path,
          hunks: edits.map((a) => ({
            oldString: a.hunks[0]?.old ?? asString(a.params.oldString),
            newString: a.hunks[0]?.new ?? asString(a.params.newString),
          })),
        });
        continue;
      }

      if (head.name === "write") {
        const path =
          typeof att.path === "string" && att.path !== ""
            ? att.path
            : head.path;
        if (path === "") {
          continue;
        }
        out.push({
          id: mintUserOpsLogId(),
          createdAtMs,
          actionXml: xml.trim(),
          action: "write",
          path,
          content: asString(head.params.content),
          kind: "file",
        });
        continue;
      }
      if (head.name === "mkdir") {
        if (head.path === "") {
          continue;
        }
        out.push({
          id: mintUserOpsLogId(),
          createdAtMs,
          actionXml: xml.trim(),
          action: "mkdir",
          path: head.path,
        });
        continue;
      }
      if (head.name === "delete") {
        if (head.path === "") {
          continue;
        }
        out.push({
          id: mintUserOpsLogId(),
          createdAtMs,
          actionXml: xml.trim(),
          action: "delete",
          path: head.path,
        });
        continue;
      }
      if (head.name === "rename") {
        const oldPath = asString(head.params.from);
        const newPath = asString(head.params.to) || (att.path ?? "");
        if (oldPath === "" || newPath === "") {
          continue;
        }
        out.push({
          id: mintUserOpsLogId(),
          createdAtMs,
          actionXml: xml.trim(),
          action: "rename",
          oldPath,
          newPath,
        });
      }
    } catch {
      // 损坏条跳过（T-UOL10）
    }
  }

  return out;
}
