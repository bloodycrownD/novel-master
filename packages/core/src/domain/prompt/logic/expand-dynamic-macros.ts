/**
 * dynamic 区宏实时展开（$time / $week_cn / $filetree）。
 *
 * @module domain/prompt/logic/expand-dynamic-macros
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import { formatLocalDateTime } from "@/infra/date-format.js";
import { renderMacro } from "@/infra/prompt-template/macro-render.js";
import { formatWeekCn } from "@/infra/prompt-template/week-cn.js";

/** dynamic 宏展开上下文。 */
export interface DynamicMacroContext {
  readonly now?: Date;
  readonly workplace?: WorkplaceService;
  /**
   * 回合快照形式的 `{{$filetree}}` 预渲染结果；
   * 传入时优先使用（不再实时调 renderFileTree），缺省回退实时渲染。
   */
  readonly filetree?: string;
}

/** 本模块的领域失败：dynamic 宏模板非法。 */
type DynamicMacroError = AppError<"PROMPT_INVALID_MACRO">;

/**
 * 展开 dynamic 文本中的白名单宏；每轮 assembly 实时计算。
 *
 * @returns 宏模板非法时返回 `PROMPT_INVALID_MACRO`，不把 infra 的 PromptError 漏出本层。
 */
export async function expandDynamicMacros(content: string, ctx: DynamicMacroContext): Promise<Result<string, DynamicMacroError>> {
  const now = ctx.now ?? new Date();
  let filetree = "";
  if (content.includes("$filetree")) {
    filetree = ctx.filetree ?? (ctx.workplace != null ? await ctx.workplace.renderFileTree() : "");
  }
  const root = {
    time: formatLocalDateTime(now),
    week_cn: formatWeekCn(now),
    filetree,
  };
  try {
    return Result.ok(renderMacro(content, { dot: {}, root }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Result.err(new AppError("PROMPT_INVALID_MACRO", `dynamic 宏展开失败：${detail}`, { cause: error }));
  }
}
