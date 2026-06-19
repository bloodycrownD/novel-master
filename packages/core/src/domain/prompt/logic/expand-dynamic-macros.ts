/**
 * dynamic 区宏实时展开（$time / $week_cn / $filetree）。
 *
 * @module domain/prompt/logic/expand-dynamic-macros
 */

import type { WorktreeService } from "@/service/worktree/worktree.port.js";
import { formatLocalDateTime } from "@/infra/date-format.js";
import { renderMacro } from "@/infra/prompt-template/macro-render.js";
import { formatWeekCn } from "@/infra/prompt-template/week-cn.js";

/** dynamic 宏展开上下文。 */
export interface DynamicMacroContext {
  readonly now?: Date;
  readonly worktree?: WorktreeService;
}

/**
 * 展开 dynamic 文本中的白名单宏；每轮 assembly 实时计算。
 */
export async function expandDynamicMacros(
  content: string,
  ctx: DynamicMacroContext,
): Promise<string> {
  const now = ctx.now ?? new Date();
  let filetree = "";
  if (content.includes("$filetree") && ctx.worktree != null) {
    filetree = await ctx.worktree.renderFileTree();
  }
  const root = {
    time: formatLocalDateTime(now),
    week_cn: formatWeekCn(now),
    filetree,
  };
  return renderMacro(content, { dot: {}, root });
}
