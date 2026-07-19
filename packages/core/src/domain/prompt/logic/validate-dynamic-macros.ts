/**
 * dynamic 区宏白名单校验（仅 `$time`、`$week_cn`、`$filetree`）。
 *
 * @module domain/prompt/logic/validate-dynamic-macros
 */

import { PromptError } from "@/errors/prompt-errors.js";
import { scanMacroActions } from "@/infra/prompt-template/macro-scan.js";

/** dynamic 区允许的 `$` 根宏键（与 UI 芯片白名单一致）。 */
export const ALLOWED_DYNAMIC_ROOT_MACROS = [
  "time",
  "week_cn",
  "filetree",
] as const;

const ALLOWED_ROOT_MACROS = new Set<string>(ALLOWED_DYNAMIC_ROOT_MACROS);

const LEGACY_DOT_MACROS = new Set(["worktree", "filetree"]);

/**
 * 校验 dynamic 文本内容中的宏；拒绝 dot 宏与非法 `$` 根键。
 */
export function validateDynamicMacros(content: string, blockLabel: string): void {
  const actions = scanMacroActions(content);
  for (const action of actions) {
    if (action.kind === "comment") {
      continue;
    }
    if (action.kind === "dot") {
      const top = action.path[0] ?? "";
      if (LEGACY_DOT_MACROS.has(top)) {
        const hint =
          top === "worktree"
            ? "请改用持久区 worktree 块，不要使用 {{.worktree}}"
            : "请使用 {{$filetree}} 替代 {{.filetree}}";
        throw new PromptError(
          "UNSUPPORTED_SYNTAX",
          `${blockLabel}：动态区不允许 {{.${top}}}；${hint}`,
        );
      }
      throw new PromptError(
        "UNSUPPORTED_SYNTAX",
        `${blockLabel}：动态区不支持点号宏（{{.${action.path.join(".")}}}）`,
      );
    }
    const key = action.path[0] ?? "";
    if (!ALLOWED_ROOT_MACROS.has(key)) {
      throw new PromptError(
        "UNKNOWN_FIELD",
        `${blockLabel}：未知的动态宏 {{$${key}}}；允许：$time、$week_cn、$filetree`,
      );
    }
  }
}

/**
 * persist 区禁止任何 `{{` 宏语法。
 */
export function rejectPersistMacros(content: string, blockLabel: string): void {
  if (content.includes("{{")) {
    throw new PromptError(
      "UNSUPPORTED_SYNTAX",
      `${blockLabel}：持久区文本块不得包含宏（{{...}}）`,
    );
  }
}
