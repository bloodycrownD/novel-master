/**
 * `fs` 内置工具的结构化参数解析与执行，以及 fs / skill / write / edit 的
 * 突变性分类（单源）。
 *
 * WHY 结构化参数：原先用命令行字符串 `split(/\s+/)` 解析，路径含空格会被截断。
 * 改成 JSON 参数（`action` + 各字段）后，路径可以是任意字符串，与 read/write/edit 风格一致。
 *
 * @module domain/tool/logic/fs-command
 */

import { SKILLS_ROOT, SkillPaths } from "@/domain/skills/logic/skill-paths.js";
import { VfsCopy } from "@/domain/vfs/logic/vfs-copy.js";
import { VfsMove } from "@/domain/vfs/logic/vfs-move.js";
import type { VfsListEntry, VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { SKILL_TOOL_NAME } from "../builtin/skill-tool.js";
import { ToolOutputLimits, TOOL_OUTPUT_MAX_BYTES } from "./tool-output-limits.js";

type ParsedFsCommand =
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

/** fs 命令或 tool 调用的分类结果。 */
type FsCommandClassification = {
  /** 是否改变工作区可见 VFS 状态。 */
  readonly mutating: boolean;
  /** 涉及路径；非突变或无法解析时为 `null`。 */
  readonly paths: readonly string[] | null;
};

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

export const FsCommand = {
  /**
   * 将结构化 {@link FsToolInput} 解析为 {@link ParsedFsCommand}。
   *
   * @remarks 已知失败走返回值通道（四期门⑦）：`action` 缺失 / 未知或必填字段
   * 为空时返回 `Result.err(INVALID_ARGUMENT)`；classify 层在调用前自行判空，
   * 工具闭包把 Err 交回 tool-runner 框架级统一收口。
   */
  parse(input: FsToolInput): Result<ParsedFsCommand, AppError> {
    const action = input.action;
    switch (action) {
      case "rm": {
        const path = FsCommand.requireField(input.path, "path");
        if (!path.ok) return Result.err(path.error);
        return Result.ok({ kind: "rm", path: path.value, recursive: input.recursive === true });
      }
      case "rmdir": {
        const path = FsCommand.requireField(input.path, "path");
        if (!path.ok) return Result.err(path.error);
        return Result.ok({ kind: "rmdir", path: path.value });
      }
      case "mv": {
        const from = FsCommand.requireField(input.from, "from");
        if (!from.ok) return Result.err(from.error);
        const to = FsCommand.requireField(input.to, "to");
        if (!to.ok) return Result.err(to.error);
        return Result.ok({ kind: "mv", from: from.value, to: to.value });
      }
      case "cp": {
        const from = FsCommand.requireField(input.from, "from");
        if (!from.ok) return Result.err(from.error);
        const to = FsCommand.requireField(input.to, "to");
        if (!to.ok) return Result.err(to.error);
        return Result.ok({ kind: "cp", from: from.value, to: to.value, recursive: input.recursive === true });
      }
      case "mkdir": {
        const path = FsCommand.requireField(input.path, "path");
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
  },

  /**
   * 分类 fs 结构化 input。
   *
   * @remarks
   * - **无 action**（缺失或非字符串或空串）：`mutating=false`、`paths=null`（与 {@link FsCommand.isMutating}、runner 路径串行化一致）。
   * - **ls**：只读，`mutating=false`。
   * - **解析失败**：`mutating=true`、`paths=null`（checkpoint 保守策略；runner 不串行化未知路径）。
   */
  classify(input: unknown): FsCommandClassification {
    const action = (input as { action?: unknown } | null | undefined)?.action;
    if (typeof action !== "string" || action === "") {
      return { mutating: false, paths: null };
    }
    const parsed = FsCommand.parse(input as FsToolInput);
    if (!parsed.ok) {
      // 解析失败（缺必填字段 / 未知 action）：checkpoint 保守策略，runner 不串行化未知路径。
      return { mutating: true, paths: null };
    }
    switch (parsed.value.kind) {
      case "ls":
        return { mutating: false, paths: null };
      case "rm":
      case "rmdir":
      case "mkdir":
        return { mutating: true, paths: [parsed.value.path] };
      case "mv":
      case "cp":
        return { mutating: true, paths: [parsed.value.from, parsed.value.to] };
    }
  },

  /** Executes a parsed fs command against the injected VFS instance.
   * 已知失败走返回值通道（四期门⑦）：VFS `Result` 失败原样接力，由调用方工具闭包 → tool-runner 框架级统一收口。
   */
  async execute(vfs: VfsService, parsed: ParsedFsCommand): Promise<Result<FsCommandResult, AppError>> {
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
        const moved = await VfsMove.move(vfs, parsed.from, parsed.to);
        if (!moved.ok) return Result.err(moved.error);
        return Result.ok({ ok: true as const });
      }
      case "cp": {
        const copied = await VfsCopy.copy(vfs, parsed.from, parsed.to, { recursive: parsed.recursive });
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
        const capped = ToolOutputLimits.capUtf8Bytes(lines, TOOL_OUTPUT_MAX_BYTES);
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
  },

  /**
   * 突变 fs 子命令返回 true；`ls` 只读。
   *
   * @remarks 接收结构化 input（`unknown`），与 {@link FsCommand.classify} 语义一致。
   */
  isMutating(input: unknown): boolean {
    return FsCommand.classify(input).mutating;
  },

  /**
   * 分类单次 tool 调用是否突变及涉及路径（write / edit / fs / skill）。
   *
   * @remarks
   * - write / edit：有非空 `path` 时返回 `[path]`，否则 `paths=null`。
   * - fs：委托 {@link FsCommand.classify}；无 action 时 `paths=null`（不串行化）。
   * - skill：委托 {@link FsCommand.classifySkillToolCall}；write/edit 按域 + 技能文件
   *   逻辑路径合成键串行化，只读 action 不串行化。
   * - 其他 tool：`mutating=false`、`paths=null`。
   */
  classifyMutatingToolCall(name: string, input: unknown): FsCommandClassification {
    if (name === "write" || name === "edit") {
      const path = typeof (input as { path?: unknown }).path === "string" ? (input as { path: string }).path : "";
      if (path.length === 0) {
        return { mutating: true, paths: null };
      }
      return { mutating: true, paths: [path] };
    }
    if (name === "fs") {
      return FsCommand.classify(input);
    }
    if (name === SKILL_TOOL_NAME) {
      return FsCommand.classifySkillToolCall(input);
    }
    return { mutating: false, paths: null };
  },

  /**
   * skill 工具分类：load/read/list 只读；write/edit 突变，返回
   * `skill:{domain}:{技能文件逻辑路径}` 合成键参与 runParallel 的同路径排队。
   *
   * 键带 `skill:{domain}:` 前缀有两重目的：与 write/edit/fs 的普通路径键
   * 天然隔离（技能存 meta 域，物理上不会与工作区文件同路径）；global 与
   * project 同名技能是不同 scope 的两个文件，互不排队（排在一起只会白损失
   * 并行度）。write 的 domain 缺省 project 与 skill-tool 的 write 分支同
   * 口径；域/名字缺失或路径非法时保守不排队——这类调用会被 schema 或
   * 服务层拒绝。
   */
  classifySkillToolCall(input: unknown): FsCommandClassification {
    const record = input as { action?: unknown; name?: unknown; domain?: unknown; path?: unknown } | null | undefined;
    const action = record?.action;
    if (action !== "write" && action !== "edit") {
      return { mutating: false, paths: null };
    }
    const skillName = record?.name;
    const domain = record?.domain;
    const effectiveDomain = action === "write" && domain == null ? "project" : domain;
    if (typeof skillName !== "string" || skillName.length === 0 || (effectiveDomain !== "global" && effectiveDomain !== "project")) {
      return { mutating: true, paths: null };
    }
    const path = record?.path;
    const resolved = SkillPaths.resolveRelPathCore(skillName, typeof path === "string" ? path : undefined);
    if (!resolved.ok) {
      return { mutating: true, paths: null };
    }
    return {
      mutating: true,
      paths: [`skill:${effectiveDomain}:${SKILLS_ROOT}/${skillName}/${resolved.rel}`],
    };
  },

  requireField(value: string | undefined, field: string): Result<string, AppError> {
    if (typeof value !== "string" || value === "") {
      return Result.err(new AppError("TOOL_INVALID_ARGUMENT", { toolName: "fs", detail: `Invalid fs command: missing or empty ${field}` }));
    }
    return Result.ok(value);
  },
} as const;
