/**
 * fs 命令与突变 tool 调用的路径/突变性分类（单源）。
 *
 * @module domain/tool/logic/fs-command-classify
 */

import { parseFsCommand } from "./fs-command.js";

/** fs 命令或 tool 调用的分类结果。 */
export type FsCommandClassification = {
  /** 是否改变工作区可见 VFS 状态。 */
  readonly mutating: boolean;
  /** 涉及路径；非突变或无法解析时为 `null`。 */
  readonly paths: readonly string[] | null;
};

/**
 * 分类 fs 子命令字符串。
 *
 * @remarks
 * - **空 command**：`mutating=false`、`paths=null`（与 {@link isMutatingFsCommand}、runner 路径串行化一致）。
 * - **ls**：只读，`mutating=false`。
 * - **解析失败**：`mutating=true`、`paths=null`（checkpoint 保守策略；runner 不串行化未知路径）。
 */
export function classifyFsCommand(command: string): FsCommandClassification {
  const trimmed = command.trim();
  if (trimmed === "") {
    return { mutating: false, paths: null };
  }
  try {
    const parsed = parseFsCommand(trimmed);
    switch (parsed.kind) {
      case "ls":
        return { mutating: false, paths: null };
      case "rm":
      case "rmdir":
      case "mkdir":
        return { mutating: true, paths: [parsed.path] };
      case "mv":
      case "cp":
        return { mutating: true, paths: [parsed.from, parsed.to] };
    }
  } catch {
    return { mutating: true, paths: null };
  }
}

/**
 * 分类单次 tool 调用是否突变及涉及路径（write / edit / fs）。
 *
 * @remarks
 * - write / edit：有非空 `path` 时返回 `[path]`，否则 `paths=null`。
 * - fs：委托 {@link classifyFsCommand}；空 command 时 `paths=null`（不串行化）。
 * - 其他 tool：`mutating=false`、`paths=null`。
 */
export function classifyMutatingToolCall(
  name: string,
  input: unknown,
): FsCommandClassification {
  if (name === "write" || name === "edit") {
    const path =
      typeof (input as { path?: unknown }).path === "string"
        ? (input as { path: string }).path
        : "";
    if (path.length === 0) {
      return { mutating: true, paths: null };
    }
    return { mutating: true, paths: [path] };
  }
  if (name === "fs") {
    const command =
      typeof (input as { command?: unknown }).command === "string"
        ? (input as { command: string }).command
        : "";
    return classifyFsCommand(command);
  }
  return { mutating: false, paths: null };
}
