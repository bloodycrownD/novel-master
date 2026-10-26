/**
 * dynamic 区宏白名单校验（仅 `$time`、`$week_cn`、`$filetree`）。
 *
 * 校验失败走 `Result`（key `PROMPT_INVALID_MACRO`），本模块不抛；调用方按
 * `if (!r.ok)` 收窄后自行决定抛还是展示。
 *
 * @module domain/prompt/logic/validate-dynamic-macros
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { scanMacroActions } from "@/infra/prompt-template/macro-scan.js";

/** dynamic 区允许的 `$` 根宏键（与 UI 芯片白名单一致）。 */
export const ALLOWED_DYNAMIC_ROOT_MACROS = ["time", "week_cn", "filetree"] as const;

const ALLOWED_ROOT_MACROS = new Set<string>(ALLOWED_DYNAMIC_ROOT_MACROS);

const LEGACY_DOT_MACROS = new Set(["worktree", "filetree"]);

/** 本模块的领域失败：宏不在白名单 / 语法非法 / 区段用错宏。 */
type PromptMacroError = AppError<"PROMPT_INVALID_MACRO">;

/**
 * 校验 dynamic 文本内容中的宏；拒绝 dot 宏与非法 `$` 根键。
 */
export function validateDynamicMacros(content: string, blockLabel: string): Result<void, PromptMacroError> {
  let actions: ReturnType<typeof scanMacroActions>;
  try {
    actions = scanMacroActions(content);
  } catch (error) {
    // 宏扫描器（infra）对残缺模板会抛旧 PromptError；在本函数内转成领域失败，不穿透。
    const detail = error instanceof Error ? error.message : String(error);
    return Result.err(new AppError("PROMPT_INVALID_MACRO", `${blockLabel}：${detail}`, { cause: error }));
  }
  for (const action of actions) {
    if (action.kind === "comment") {
      continue;
    }
    if (action.kind === "dot") {
      const top = action.path[0] ?? "";
      if (LEGACY_DOT_MACROS.has(top)) {
        const hint = top === "worktree" ? "请改用 prompts.workplace 常驻工作区开关，不要使用 {{.worktree}}" : "请使用 {{$filetree}} 替代 {{.filetree}}";
        return Result.err(new AppError("PROMPT_INVALID_MACRO", `${blockLabel}：动态区不允许 {{.${top}}}；${hint}`));
      }
      return Result.err(new AppError("PROMPT_INVALID_MACRO", `${blockLabel}：动态区不支持点号宏（{{.${action.path.join(".")}}}）`));
    }
    const key = action.path[0] ?? "";
    if (!ALLOWED_ROOT_MACROS.has(key)) {
      return Result.err(new AppError("PROMPT_INVALID_MACRO", `${blockLabel}：未知的动态宏 {{$${key}}}；允许：$time、$week_cn、$filetree`));
    }
  }
  return Result.ok(undefined);
}

/**
 * persist 区禁止任何 `{{` 宏语法。
 */
export function rejectPersistMacros(content: string, blockLabel: string): Result<void, PromptMacroError> {
  if (content.includes("{{")) {
    return Result.err(new AppError("PROMPT_INVALID_MACRO", `${blockLabel}：持久区文本块不得包含宏（{{...}}）`));
  }
  return Result.ok(undefined);
}
