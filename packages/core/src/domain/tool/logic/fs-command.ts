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

type FsCommand =
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

type FsLsOutput = {
  readonly entries: readonly VfsListEntry[];
  readonly total: number;
  readonly truncated: boolean;
  readonly omitted?: number;
};

export type FsCommandResult = { readonly ok: true } | FsLsOutput;

function requireField(value: string | undefined, field: string): Result<string, AppError> {
  if (typeof value !== "string" || value === "") {
    return Result.err(new AppError("TOOL_INVALID_ARGUMENT", { toolName: "fs", detail: `Invalid fs command: missing or empty ${field}` }));
  }
  return Result.ok(value);
}

/**
 * 将结构化 {@link FsToolInput} 解析为 {@link FsCommand}。
 *
 * @remarks 已知失败走返回值通道（四期门⑦）：`action` 缺失 / 未知或必填字段
 * 为空时返回 `Result.err(INVALID_ARGUMENT)`；classify 层在调用前自行判空，
 * 工具闭包把 Err 交回 tool-runner 框架级统一收口。
 */
export function parseFsCommand(input: FsToolInput): Result<FsCommand, AppError> {
  const action = input.action;
  switch (action) {
    case "rm": {
      const path = requireField(input.path, "path");
      if (!path.ok) return Result.err(path.error);
      return Result.ok({ kind: "rm", path: path.value, recursive: input.recursive === true });
    }
    case "rmdir": {
      const path = requireField(input.path, "path");
      if (!path.ok) return Result.err(path.error);
      return Result.ok({ kind: "rmdir", path: path.value });
    }
    case "mv": {
      const from = requireField(input.from, "from");
      if (!from.ok) return Result.err(from.error);
      const to = requireField(input.to, "to");
      if (!to.ok) return Result.err(to.error);
      return Result.ok({ kind: "mv", from: from.value, to: to.value });
    }
    case "cp": {
      const from = requireField(input.from, "from");
      if (!from.ok) return Result.err(from.error);
      const to = requireField(input.to, "to");
      if (!to.ok) return Result.err(to.error);
      return Result.ok({ kind: "cp", from: from.value, to: to.value, recursive: input.recursive === true });
    }
    case "mkdir": {
      const path = requireField(input.path, "path");
      if (!path.ok) return Result.err(path.error);
      return Result.ok({ kind: "mkdir", path: path.value });
    }
    case "ls": {
      const dir = typeof input.path === "string" && input.path !== "" ? input.path : "/";
      return Result.ok({ kind: "ls", dir, recursive: input.recursive === true });
    }
    default:
      return Result.err(new AppError("TOOL_INVALID_ARGUMENT", { toolName: "fs", detail: `Invalid fs command: ${typeof action === "string" && action !== "" ? `unknown action: ${action}` : "missing action"}` }));
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

/** Executes a parsed fs command against the injected VFS instance.
 * 已知失败走返回值通道（四期门⑦）：VFS `Result` 失败原样接力，由调用方工具闭包 → tool-runner 框架级统一收口。
 */
export async function executeFsCommand(vfs: VfsService, parsed: FsCommand): Promise<Result<FsCommandResult, AppError>> {
  switch (parsed.kind) {
    case "rm": {
      // `rm` 未带 `-r` 时，若目标是目录则自动递归删除（兼容 Agent 常见用法）。
      let recursive = parsed.recursive;
      if (!recursive) {
        const read = await vfs.read(parsed.path);
        if (read.ok) recursive = false;
        else if (read.error.key === "VFS_IS_DIRECTORY") recursive = true;
        else if (read.error.key !== "VFS_NOT_FOUND") return Result.err(read.error);
        else {
          const entries = await vfs.list(parsed.path);
          if (entries.ok) recursive = entries.value.length > 0;
          else if (entries.error.key !== "VFS_NOT_FOUND") return Result.err(entries.error);
        }
      }
      const deleted = await vfs.delete(parsed.path, { recursive });
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
      const lines = entries.value.map((entry) => `${entry.path}\t${entry.kind}`);
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
      const omitted = capped.truncated ? entries.value.length - formattedEntries.length : undefined;
      return Result.ok({
        entries: formattedEntries,
        total: entries.value.length,
        truncated: capped.truncated,
        ...(omitted != null && omitted > 0 ? { omitted } : {}),
      });
    }
  }
}
