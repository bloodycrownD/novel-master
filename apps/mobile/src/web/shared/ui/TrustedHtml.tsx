/**
 * 信任 HTML 边界：宿主已消毒的 HTML 片段统一经此写入。
 * - ui：`<TrustedHtml html={…} />`
 * - runtime：`applyTrustedHtml(el, html)`（runtime 唯一允许 import 的 shared/ui 模块）
 */
import { h } from 'preact';
import type { JSX } from 'preact';

export type TrustedHtmlProps = {
  html: string;
  className?: string;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'dangerouslySetInnerHTML' | 'children'>;

/**
 * Preact 组件：用 dangerouslySetInnerHTML 注入已消毒 HTML。
 */
export function TrustedHtml({ html, className, ...rest }: TrustedHtmlProps) {
  return (
    <div
      className={className}
      {...rest}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * runtime 命令式写入：等价于组件路径的信任边界。
 */
export function applyTrustedHtml(el: Element, html: string): void {
  el.innerHTML = html;
}
