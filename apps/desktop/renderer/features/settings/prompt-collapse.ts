/**
 * 提示词超长折叠阈值（双端各自持有同值常量，便于测试与调整）。
 * 超过该长度即折叠为 3 行省略预览，点击进入全屏编辑。
 */
export const PROMPT_COLLAPSE_THRESHOLD = 600;

/** 判断提示词是否超过折叠阈值（纯函数）。 */
export function isPromptCollapsed(value: string): boolean {
  return value.length > PROMPT_COLLAPSE_THRESHOLD;
}
