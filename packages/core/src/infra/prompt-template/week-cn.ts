/**
 * Chinese weekday label for prompt `$.week_cn` macro.
 *
 * @module infra/prompt-template/week-cn
 */

/**
 * 中文星期标签。
 */
export const WeekCn = {
  /** Local Chinese weekday (e.g. 「星期一」). */
  format(date: Date): string {
    return date.toLocaleDateString("zh-CN", { weekday: "long" });
  },
} as const;
