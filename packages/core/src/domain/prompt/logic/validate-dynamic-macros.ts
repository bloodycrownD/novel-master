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
import type { MessageLike } from "@/common/i18n.js";
import { scanMacroActions } from "@/infra/prompt-template/macro-scan.js";

/** dynamic 区允许的 `$` 根宏键（与 UI 芯片白名单一致）。 */
export const ALLOWED_DYNAMIC_ROOT_MACROS = ["time", "week_cn", "filetree"] as const;

const ALLOWED_ROOT_MACROS = new Set<string>(ALLOWED_DYNAMIC_ROOT_MACROS);

const LEGACY_DOT_MACROS = new Set(["worktree", "filetree"]);

/** 本模块的领域失败：宏不在白名单 / 语法非法 / 区段用错宏。 */
type PromptMacroError = AppError<"PROMPT_INVALID_MACRO">;

/**
 * 校验 dynamic 文本内容中的宏；拒绝 dot 宏与非法 `$` 根键。
 *
 * `blockLabel` 是块名片段（`块「N」` string 或 `label.agent.custom_attach`
 * descriptor），作为 `{block}` 参数嵌进各 key 的文案。
 */
export function validateDynamicMacros(content: string, blockLabel: MessageLike): Result<void, PromptMacroError> {
  let actions: ReturnType<typeof scanMacroActions>;
  try {
    actions = scanMacroActions(content);
  } catch (error) {
    // 宏扫描器（infra）对残缺模板会抛旧 PromptError；在本函数内转成领域失败，不穿透。
    const detail = error instanceof Error ? error.message : String(error);
    return Result.err(new AppError("PROMPT_INVALID_MACRO", { key: "error.prompt.invalid_macro.scan_failed", params: { block: blockLabel, detail } }, { cause: error }));
  }
  for (const action of actions) {
    if (action.kind === "comment") {
      continue;
    }
    if (action.kind === "dot") {
      const top = action.path[0] ?? "";
      if (LEGACY_DOT_MACROS.has(top)) {
        const hint = { key: top === "worktree" ? "error.prompt.invalid_macro.worktree_removed" : "error.prompt.invalid_macro.filetree_alias" };
        return Result.err(new AppError("PROMPT_INVALID_MACRO", { key: "error.prompt.invalid_macro.dot_removed", params: { block: blockLabel, macro: top, hint } }));
      }
      return Result.err(new AppError("PROMPT_INVALID_MACRO", { key: "error.prompt.invalid_macro.dot_unsupported", params: { block: blockLabel, path: action.path.join(".") } }));
    }
    const key = action.path[0] ?? "";
    if (!ALLOWED_ROOT_MACROS.has(key)) {
      return Result.err(new AppError("PROMPT_INVALID_MACRO", { key: "error.prompt.invalid_macro.unknown", params: { block: blockLabel, key } }));
    }
  }
  return Result.ok(undefined);
}

/**
 * persist 区禁止任何 `{{` 宏语法。
 */
export function rejectPersistMacros(content: string, blockLabel: MessageLike): Result<void, PromptMacroError> {
  if (content.includes("{{")) {
    return Result.err(new AppError("PROMPT_INVALID_MACRO", { key: "error.prompt.invalid_macro.persist_forbidden", params: { block: blockLabel } }));
  }
  return Result.ok(undefined);
}
