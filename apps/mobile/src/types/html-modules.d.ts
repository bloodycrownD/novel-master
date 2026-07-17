/**
 * 将 `.html` 声明为默认导出的 UTF-8 字符串（Metro/Jest 均按此契约交付）。
 */
declare module '*.html' {
  const html: string;
  export default html;
}
