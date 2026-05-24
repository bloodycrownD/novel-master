/**
 * Chinese weekday label for prompt `$.week_cn` macro.
 *
 * @module infra/prompt-template/week-cn
 */

/** Local Chinese weekday (e.g. 「星期一」). */
export function formatWeekCn(date: Date): string {
  return date.toLocaleDateString("zh-CN", { weekday: "long" });
}
