/**
 * Strict grammar parser for the `fs` builtin tool command string.
 *
 * @module domain/tool/logic/fs-command
 */

import { copyVfsPath } from "@/domain/vfs/logic/vfs-copy.js";
import { moveVfsPath } from "@/domain/vfs/logic/vfs-move.js";
import type { VfsListEntry, VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import { isVfsError } from "@/errors/vfs-errors.js";
import { ToolError } from "@/errors/tool-errors.js";
import { classifyFsCommand } from "./fs-command-classify.js";
import {
  capUtf8Bytes,
  TOOL_OUTPUT_MAX_BYTES,
} from "./tool-output-limits.js";

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

export type FsLsOutput = {
  readonly entries: readonly VfsListEntry[];
  readonly total: number;
  readonly truncated: boolean;
  readonly omitted?: number;
};

export type FsCommandResult = { readonly ok: true } | FsLsOutput;

const SHELL_METACHAR_RE = /&&|\||;/;

function invalidCommand(command: string, reason: string): never {
  throw new ToolError(
    "INVALID_ARGUMENT",
    `Invalid fs command: ${reason} (command: ${command})`,
    { toolName: "fs" },
  );
}

/** Parses a single fs subcommand; rejects shell chaining and unknown tokens. */
export function parseFsCommand(command: string): FsCommand {
  const trimmed = command.trim();
  if (trimmed === "") {
    invalidCommand(command, "empty command");
  }
  if (SHELL_METACHAR_RE.test(trimmed)) {
    invalidCommand(command, "shell metacharacters are not supported");
  }

  const tokens = trimmed.split(/\s+/);
  const head = tokens[0]!;

  switch (head) {
    case "rm": {
      if (tokens.length === 2) {
        return { kind: "rm", path: tokens[1]!, recursive: false };
      }
      if (tokens.length === 3 && tokens[1] === "-r") {
        return { kind: "rm", path: tokens[2]!, recursive: true };
      }
      return invalidCommand(command, "expected `rm <path>` or `rm -r <path>`");
    }
    case "rmdir": {
      if (tokens.length === 2) {
        return { kind: "rmdir", path: tokens[1]! };
      }
      return invalidCommand(command, "expected `rmdir <path>`");
    }
    case "mv": {
      if (tokens.length === 3) {
        return { kind: "mv", from: tokens[1]!, to: tokens[2]! };
      }
      return invalidCommand(command, "expected `mv <from> <to>`");
    }
    case "cp": {
      if (tokens.length === 3) {
        return { kind: "cp", from: tokens[1]!, to: tokens[2]!, recursive: false };
      }
      if (tokens.length === 4 && tokens[1] === "-r") {
        return {
          kind: "cp",
          from: tokens[2]!,
          to: tokens[3]!,
          recursive: true,
        };
      }
      return invalidCommand(
        command,
        "expected `cp <from> <to>` or `cp -r <from> <to>`",
      );
    }
    case "mkdir": {
      if (tokens.length === 2) {
        return { kind: "mkdir", path: tokens[1]! };
      }
      return invalidCommand(command, "expected `mkdir <path>`");
    }
    case "ls": {
      if (tokens.length === 1) {
        return { kind: "ls", dir: "/", recursive: false };
      }
      if (tokens.length === 2) {
        return { kind: "ls", dir: tokens[1]!, recursive: false };
      }
      if (tokens.length === 3 && tokens[1] === "-r") {
        return { kind: "ls", dir: tokens[2]!, recursive: true };
      }
      return invalidCommand(
        command,
        "expected `ls [dir]`, `ls <dir>`, or `ls -r <dir>`",
      );
    }
    default:
      return invalidCommand(command, `unknown subcommand: ${head}`);
  }
}

/** 突变 fs 子命令返回 true；`ls` 只读。 */
export function isMutatingFsCommand(command: string): boolean {
  return classifyFsCommand(command).mutating;
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
async function rmRecursiveWhenTargetIsDirectory(
  vfs: VfsService,
  path: string,
  recursive: boolean,
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
  parsed: FsCommand,
): Promise<FsCommandResult> {
  switch (parsed.kind) {
    case "rm": {
      const recursive = await rmRecursiveWhenTargetIsDirectory(
        vfs,
        parsed.path,
        parsed.recursive,
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
      const entries = await vfs.list(parsed.dir, { recursive: parsed.recursive });
      return formatLsOutput(entries);
    }
  }
}
