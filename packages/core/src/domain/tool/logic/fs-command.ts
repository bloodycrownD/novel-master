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
import type { VfsListEntry, VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
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
  throw new AppError("TOOL_INVALID_ARGUMENT", {toolName: "fs", detail: `Invalid fs command: ${reason}`});
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
      const dir = typeof input.path === "string" && input.path !== "" ? input.path : "/";
      return { kind: "ls", dir, recursive: input.recursive === true };
    }
    default:
      invalidCommand(typeof action === "string" && action !== "" ? `unknown action: ${action}` : "missing action");
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
  const omitted = truncated ? entries.length - formattedEntries.length : undefined;
  return {
    entries: formattedEntries,
    total: entries.length,
    truncated,
    ...(omitted != null && omitted > 0 ? { omitted } : {}),
  };
}

/** `rm` 未带 `-r` 时，若目标是目录则自动递归删除（兼容 Agent 常见用法）。 */
async function rmRecursiveWhenTargetIsDirectory(vfs: VfsService, path: string, recursive: boolean): Promise<Result<boolean, AppError>> {
  if (recursive) {
    return Result.ok(true);
  }
  const read = await vfs.read(path);
  if (read.ok) {
    return Result.ok(false);
  }
  if (read.error.key === "VFS_IS_DIRECTORY") {
    return Result.ok(true);
  }
  if (read.error.key !== "VFS_NOT_FOUND") {
    return Result.err(read.error);
  }
  const entries = await vfs.list(path);
  if (entries.ok) {
    return Result.ok(entries.value.length > 0);
  }
  if (entries.error.key === "VFS_NOT_FOUND") {
    return Result.ok(false);
  }
  return Result.err(entries.error);
}

/** Executes a parsed fs command against the injected VFS instance.
 * 已知失败走返回值通道（四期门⑦）：VFS `Result` 失败原样接力，由调用方工具闭包 → tool-runner 框架级统一收口。
 */
export async function executeFsCommand(vfs: VfsService, parsed: FsCommand): Promise<Result<FsCommandResult, AppError>> {
  switch (parsed.kind) {
    case "rm": {
      const recursiveWhenDirectory = await rmRecursiveWhenTargetIsDirectory(vfs, parsed.path, parsed.recursive);
      if (!recursiveWhenDirectory.ok) return Result.err(recursiveWhenDirectory.error);
      const deleted = await vfs.delete(parsed.path, { recursive: recursiveWhenDirectory.value });
      if (!deleted.ok) return Result.err(deleted.error);
      return Result.ok({ ok: true as const });
    }
    case "rmdir": {
      // WHY: rmdir maps to non-recursive delete — VFS rejects non-empty directories.
      const deleted = await vfs.delete(parsed.path, { recursive: false });
      if (!deleted.ok) return Result.err(deleted.error);
      return Result.ok({ ok: true as const });
    }
    case "mv": {
      const moved = await moveVfsPath(vfs, parsed.from, parsed.to);
      if (!moved.ok) return Result.err(moved.error);
      return Result.ok({ ok: true as const });
    }
    case "cp": {
      const copied = await copyVfsPath(vfs, parsed.from, parsed.to, { recursive: parsed.recursive });
      if (!copied.ok) return Result.err(copied.error);
      return Result.ok({ ok: true as const });
    }
    case "mkdir": {
      const made = await vfs.mkdir(parsed.path);
      if (!made.ok) return Result.err(made.error);
      return Result.ok({ ok: true as const });
    }
    case "ls": {
      const listOptions = { recursive: parsed.recursive };
      const entries = await vfs.list(parsed.dir, listOptions);
      if (!entries.ok) return Result.err(entries.error);
      return Result.ok(formatLsOutput(entries.value));
    }
  }
}
