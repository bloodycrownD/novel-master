/** 紧凑 locale 整数格式化（供编辑器字数统计等）。 */
export function formatCharCount(n: number): string {
  return n.toLocaleString("zh-CN");
}
