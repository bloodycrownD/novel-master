/** 紧凑 locale 整数格式化（编辑器字数统计、指标条 token 数等共用单点）。 */
export function formatCharCount(n: number): string {
  return n.toLocaleString("zh-CN");
}
