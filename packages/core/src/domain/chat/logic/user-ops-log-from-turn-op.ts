/**
 * 由用户 VFS turn op（actionXml + tools）派生一条 {@link UserOpsLogEntry}。
 *
 * @module domain/chat/logic/user-ops-log-from-turn-op
 */

import type { UserOpsLogEntry } from "../model/user-ops-log.schema.js";
import { resolveRenameOrMoveAction } from "./status-chip-label.js";
import { parseAllUserVfsActionsFromText } from "./user-vfs-turn-view.js";

/** executeOp 入参的最小形状（避免 domain → service 反向依赖）。 */
export type UserOpsLogTurnOpInput = {
  readonly actionXml: string;
  readonly tools: readonly {
    readonly name: string;
    readonly input: unknown;
  }[];
};

function mintUserOpsLogId(): string {
  return `uol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * 从 turn op 的 tools / actionXml 派生结构化日志条目。
 * 无法识别时尽力从 XML 首个 action 兜底；仍失败则抛错（调用方应吞掉，不回滚盘）。
 */
export function userOpsLogEntryFromTurnOp(
  op: UserOpsLogTurnOpInput,
): UserOpsLogEntry {
  const createdAtMs = Date.now();
  const id = mintUserOpsLogId();
  const actionXml = op.actionXml;
  const tools = op.tools;

  if (tools.length > 0) {
    const first = tools[0]!;
    if (first.name === "write") {
      const input = (first.input ?? {}) as Record<string, unknown>;
      const path = asString(input.path);
      const content = asString(input.content);
      return {
        id,
        createdAtMs,
        actionXml,
        action: "write",
        path,
        content,
        kind: "file",
      };
    }

    if (first.name === "edit") {
      const hunks = tools
        .filter((t) => t.name === "edit")
        .map((t) => {
          const input = (t.input ?? {}) as Record<string, unknown>;
          return {
            oldString: asString(input.oldString),
            newString: asString(input.newString),
          };
        });
      const path = asString(
        ((first.input ?? {}) as Record<string, unknown>).path,
      );
      if (hunks.length > 0 && path !== "") {
        return {
          id,
          createdAtMs,
          actionXml,
          action: "edit",
          path,
          hunks,
        };
      }
    }

    if (first.name === "fs") {
      const input = (first.input ?? {}) as Record<string, unknown>;
      const command = asString(input.command).trim();
      if (command.startsWith("mkdir ")) {
        const path = command.slice("mkdir ".length).trim();
        return {
          id,
          createdAtMs,
          actionXml,
          action: "mkdir",
          path,
        };
      }
      if (command.startsWith("rm ")) {
        const rest = command.slice(3).trim();
        const path = rest.startsWith("-r ")
          ? rest.slice(3).trim()
          : rest;
        return {
          id,
          createdAtMs,
          actionXml,
          action: "delete",
          path,
        };
      }
      if (command.startsWith("mv ")) {
        const parts = command.slice(3).trim().split(/\s+/);
        const from = parts[0] ?? "";
        const to = parts[1] ?? "";
        return {
          id,
          createdAtMs,
          actionXml,
          action: resolveRenameOrMoveAction(from, to),
          oldPath: from,
          newPath: to,
        };
      }
    }
  }

  // XML 兜底（旧合成 / 异常 tool 形态）
  const parsed = parseAllUserVfsActionsFromText(actionXml);
  if (parsed.length === 0) {
    throw new Error("userOpsLogEntryFromTurnOp: 无法从 op 派生日志条目");
  }

  const edits = parsed.filter((a) => a.name === "edit");
  if (edits.length > 0) {
    const path = edits[0]!.path;
    return {
      id,
      createdAtMs,
      actionXml,
      action: "edit",
      path,
      hunks: edits.map((a) => ({
        oldString: a.hunks[0]?.old ?? asString(a.params.oldString),
        newString: a.hunks[0]?.new ?? asString(a.params.newString),
      })),
    };
  }

  const head = parsed[0]!;
  if (head.name === "write") {
    return {
      id,
      createdAtMs,
      actionXml,
      action: "write",
      path: head.path,
      content: asString(head.params.content),
      kind: "file",
    };
  }
  if (head.name === "mkdir") {
    return {
      id,
      createdAtMs,
      actionXml,
      action: "mkdir",
      path: head.path,
    };
  }
  if (head.name === "delete") {
    return {
      id,
      createdAtMs,
      actionXml,
      action: "delete",
      path: head.path,
    };
  }
  if (head.name === "rename" || head.name === "move") {
    const oldPath = asString(head.params.from);
    const newPath = asString(head.params.to);
    return {
      id,
      createdAtMs,
      actionXml,
      action: resolveRenameOrMoveAction(oldPath, newPath),
      oldPath,
      newPath,
    };
  }

  throw new Error(
    `userOpsLogEntryFromTurnOp: 未支持的 action ${head.name}`,
  );
}
