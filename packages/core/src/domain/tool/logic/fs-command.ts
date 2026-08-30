/**
 * `fs` 内置工具的结构化参数解析与执行。
 *
 * WHY 结构化参数：原先用命令行字符串 `split(/\s+/)` 解析，路径含空格会被截断。
 * 改成 JSON 参数（`action` + 各字段）后，路径可以是任意字符串，与 read/write/edit 风格一致。
 *
 * @module domain/tool/logic/fs-command
 */

import { copyVfsPath } from "@/domain/vfs/logic/vfs-copy.js";
import { moveVfsPath } from "@/domain/vfs/logic/vfs-move.js";
import type {
  VfsListEntry,
  VfsService,
} from "@/domain/vfs/ports/vfs-service.port.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import { ToolError } from "@/errors/tool-errors.js";
import { classifyFsCommand } from "./fs-command-classify.js";
import { capUtf8Bytes, TOOL_OUTPUT_MAX_BYTES } from "./tool-output-limits.js";

export type FsCommand =
  | { readonly kind: "rm"; readonly path: string; readonly recursive: boolean }
  | { readonly kind: "rmdir"; readonly path: string }
  | { readonly kind: "mv"; readonly from: string; readonly to: string }
  | {
      readonly kind: "cp";
      readonly from: string;
      readonly to: string;
      readonly recursive: boolean;
    }
  | { readonly kind: "mkdir"; readonly path: string }
  | { readonly kind: "ls"; readonly dir: string; readonly recursive: boolean };

/**
 * `fs` 工具的结构化输入。
 *
 * - `action`：子命令；`ls` / `rm` / `rmdir` / `mv` / `cp` / `mkdir`。
 * - `path`：单路径类子命令（ls/rm/rmdir/mkdir）的目标路径。`ls` 省略时列根目录。
 * - `from` / `to`：`mv` / `cp` 的源与目标。
 * - `recursive`：`ls` / `rm` / `cp` 的递归标记。
 */
export type FsToolInput = {
  readonly action?: string;
  readonly path?: string;
  readonly from?: string;
  readonly to?: string;
  readonly recursive?: boolean;
};

export type FsLsOutput = {
  readonly entries: readonly VfsListEntry[];
  readonly total: number;
  readonly truncated: boolean;
  readonly omitted?: number;
};

export type FsCommandResult = { readonly ok: true } | FsLsOutput;

function invalidCommand(reason: string): never {
  throw new ToolError("INVALID_ARGUMENT", `Invalid fs command: ${reason}`, {
    toolName: "fs",
  });
}

function requireField(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value === "") {
    invalidCommand(`missing or empty ${field}`);
  }
  return value;
}

/**
 * 将结构化 {@link FsToolInput} 解析为 {@link FsCommand}。
 *
 * @remarks `action` 为空字符串或缺失时抛 `INVALID_ARGUMENT`；classify 层在调用前自行判空。
 */
export function parseFsCommand(input: FsToolInput): FsCommand {
  const action = input.action;
  switch (action) {
    case "rm":
      return {
        kind: "rm",
        path: requireField(input.path, "path"),
        recursive: input.recursive === true,
      };
    case "rmdir":
      return { kind: "rmdir", path: requireField(input.path, "path") };
    case "mv":
      return {
        kind: "mv",
        from: requireField(input.from, "from"),
        to: requireField(input.to, "to"),
      };
    case "cp":
      return {
        kind: "cp",
        from: requireField(input.from, "from"),
        to: requireField(input.to, "to"),
        recursive: input.recursive === true,
      };
    case "mkdir":
      return { kind: "mkdir", path: requireField(input.path, "path") };
    case "ls": {
      const dir =
        typeof input.path === "string" && input.path !== "" ? input.path : "/";
      return { kind: "ls", dir, recursive: input.recursive === true };
    }
    default:
      invalidCommand(
        typeof action === "string" && action !== ""
          ? `unknown action: ${action}`
          : "missing action"
      );
  }
}

/**
 * 突变 fs 子命令返回 true；`ls` 只读。
 *
 * @remarks 接收结构化 input（`unknown`），与 {@link classifyFsCommand} 语义一致。
 */
export function isMutatingFsCommand(input: unknown): boolean {
  return classifyFsCommand(input).mutating;
}

function formatListEntry(entry: VfsListEntry): string {
  return `${entry.path}\t${entry.kind}`;
}

function formatLsOutput(entries: readonly VfsListEntry[]): FsLsOutput {
  const lines = entries.map(formatListEntry);
  const capped = capUtf8Bytes(lines, TOOL_OUTPUT_MAX_BYTES);
  const formattedEntries = capped.lines.map((line) => {
    const tab = line.indexOf("\t");
    const path = tab >= 0 ? line.slice(0, tab) : line;
    const kind = tab >= 0 ? line.slice(tab + 1) : "file";
    return {
      path,
      kind: kind as VfsListEntry["kind"],
    };
  });
  const truncated = capped.truncated;
  const omitted = truncated
    ? entries.length - formattedEntries.length
    : undefined;
  return {
    entries: formattedEntries,
    total: entries.length,
    truncated,
    ...(omitted != null && omitted > 0 ? { omitted } : {}),
  };
}

/** `rm` 未带 `-r` 时，若目标是目录则自动递归删除（兼容 Agent 常见用法）。 */
async function rmRecursiveWhenTargetIsDirectory(
  vfs: VfsService,
  path: string,
  recursive: boolean
): Promise<boolean> {
  if (recursive) {
    return true;
  }
  try {
    await vfs.read(path);
    return false;
  } catch (error: unknown) {
    if (isVfsError(error, "IS_DIRECTORY")) {
      return true;
    }
    if (isVfsError(error, "NOT_FOUND")) {
      try {
        const entries = await vfs.list(path);
        return entries.length > 0;
      } catch (listError: unknown) {
        if (isVfsError(listError, "NOT_FOUND")) {
          return false;
        }
        throw listError;
      }
    }
    throw error;
  }
}

/** Executes a parsed fs command against the injected VFS instance. */
export async function executeFsCommand(
  vfs: VfsService,
  parsed: FsCommand
): Promise<FsCommandResult> {
  switch (parsed.kind) {
    case "rm": {
      const recursive = await rmRecursiveWhenTargetIsDirectory(
        vfs,
        parsed.path,
        parsed.recursive
      );
      await vfs.delete(parsed.path, { recursive });
      return { ok: true as const };
    }
    case "rmdir":
      // WHY: rmdir maps to non-recursive delete — VFS rejects non-empty directories.
      await vfs.delete(parsed.path, { recursive: false });
      return { ok: true as const };
    case "mv":
      await moveVfsPath(vfs, parsed.from, parsed.to);
      return { ok: true as const };
    case "cp":
      await copyVfsPath(vfs, parsed.from, parsed.to, {
        recursive: parsed.recursive,
      });
      return { ok: true as const };
    case "mkdir":
      await vfs.mkdir(parsed.path);
      return { ok: true as const };
    case "ls": {
      const entries = await vfs.list(parsed.dir, {
        recursive: parsed.recursive,
      });
      return formatLsOutput(entries);
    }
  }
}
