/**
 * 从组装产物 HTML 抽取 &lt;script&gt; 正文（T-BR 测试唯一取 boot 方式）。
 */
export function extractBootScriptFromHtml(html: string): string {
  const match = /<script>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) {
    throw new Error('组装 HTML 中未找到 <script> 块');
  }
  return match[1];
}
