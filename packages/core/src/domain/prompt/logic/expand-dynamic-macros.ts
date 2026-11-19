/**
 * dynamic 区宏实时展开（$time / $week_cn / $filetree）。
 *
 * @module domain/prompt/logic/expand-dynamic-macros
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import { DateTime } from "@/common/datetime.js";
import { MacroRender } from "@/infra/prompt-template/macro-render.js";
import { WeekCn } from "@/infra/prompt-template/week-cn.js";

/** dynamic 宏展开上下文。 */
interface DynamicMacroContext {
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

export const DynamicMacrosExpansion = {
  /**
   * 展开 dynamic 文本中的白名单宏；每轮 assembly 实时计算。
   *
   * @returns 宏模板非法时返回 `PROMPT_INVALID_MACRO`，不把 infra 的 AppError 漏出本层。
   */
  expand: async (content: string, ctx: DynamicMacroContext): Promise<Result<string, DynamicMacroError>> => {
    const now = ctx.now ?? new Date();
    let filetree = "";
    if (content.includes("$filetree")) {
      if (ctx.filetree != null) {
        filetree = ctx.filetree;
      } else if (ctx.workplace != null) {
        const rendered = await ctx.workplace.renderFileTree();
        if (!rendered.ok) {
          // 本层契约：不把 infra 的 AppError 漏出（见 @returns），统一收口为 PROMPT_INVALID_MACRO。
          return Result.err(new AppError("PROMPT_INVALID_MACRO", { detail: `$filetree render failed: ${rendered.error.message}`, cause: rendered.error }));
        }
        filetree = rendered.value;
      }
    }
    const root = {
      time: DateTime.localDateTime(now),
      week_cn: WeekCn.format(now),
      filetree,
    };
    // MacroRender.render 已 Result 化（错误通道迁移四期）：Err 在本层转译收口（见 @returns，
    // 不把 infra 的 AppError 漏出），detail/cause 与旧 catch 路径一致。
    const rendered = MacroRender.render(content, { dot: {}, root });
    if (!rendered.ok) {
      return Result.err(new AppError("PROMPT_INVALID_MACRO", { descriptor: { key: "error.prompt.macro_expand_failed", params: { detail: rendered.error.message } }, cause: rendered.error }));
    }
    return Result.ok(rendered.value);
  },
} as const;
