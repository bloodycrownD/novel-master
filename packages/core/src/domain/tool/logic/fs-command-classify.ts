/**
 * fs 命令与突变 tool 调用的路径/突变性分类（单源）。
 *
 * @module domain/tool/logic/fs-command-classify
 */

import {
  SKILLS_ROOT,
  resolveSkillRelPathCore,
} from "@/domain/skills/logic/skill-paths.js";
import { SKILL_TOOL_NAME } from "../builtin/skill-tool.js";
import type { FsToolInput } from "./fs-command.js";
import { parseFsCommand } from "./fs-command.js";

/** fs 命令或 tool 调用的分类结果。 */
export type FsCommandClassification = {
  /** 是否改变工作区可见 VFS 状态。 */
  readonly mutating: boolean;
  /** 涉及路径；非突变或无法解析时为 `null`。 */
  readonly paths: readonly string[] | null;
};

/**
 * 分类 fs 结构化 input。
 *
 * @remarks
 * - **无 action**（缺失或非字符串或空串）：`mutating=false`、`paths=null`（与 {@link isMutatingFsCommand}、runner 路径串行化一致）。
 * - **ls**：只读，`mutating=false`。
 * - **解析失败**：`mutating=true`、`paths=null`（checkpoint 保守策略；runner 不串行化未知路径）。
 */
export function classifyFsCommand(input: unknown): FsCommandClassification {
  const action = (input as { action?: unknown } | null | undefined)?.action;
  if (typeof action !== "string" || action === "") {
    return { mutating: false, paths: null };
  }
  try {
    const parsed = parseFsCommand(input as FsToolInput);
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
function classifySkillToolCall(input: unknown): FsCommandClassification {
  const record = input as
    | { action?: unknown; name?: unknown; domain?: unknown; path?: unknown }
    | null
    | undefined;
  const action = record?.action;
  if (action !== "write" && action !== "edit") {
    return { mutating: false, paths: null };
  }
  const skillName = record?.name;
  const domain = record?.domain;
  const effectiveDomain =
    action === "write" && domain == null ? "project" : domain;
  if (
    typeof skillName !== "string" ||
    skillName.length === 0 ||
    (effectiveDomain !== "global" && effectiveDomain !== "project")
  ) {
    return { mutating: true, paths: null };
  }
  const path = record?.path;
  const resolved = resolveSkillRelPathCore(
    skillName,
    typeof path === "string" ? path : undefined,
  );
  if (!resolved.ok) {
    return { mutating: true, paths: null };
  }
  return {
    mutating: true,
    paths: [
      `skill:${effectiveDomain}:${SKILLS_ROOT}/${skillName}/${resolved.rel}`,
    ],
  };
}

/**
 * 分类单次 tool 调用是否突变及涉及路径（write / edit / fs / skill）。
 *
 * @remarks
 * - write / edit：有非空 `path` 时返回 `[path]`，否则 `paths=null`。
 * - fs：委托 {@link classifyFsCommand}；无 action 时 `paths=null`（不串行化）。
 * - skill：委托 {@link classifySkillToolCall}；write/edit 按域 + 技能文件
 *   逻辑路径合成键串行化，只读 action 不串行化。
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
    return classifyFsCommand(input);
  }
  if (name === SKILL_TOOL_NAME) {
    return classifySkillToolCall(input);
  }
  return { mutating: false, paths: null };
}
