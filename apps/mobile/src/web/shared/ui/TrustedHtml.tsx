/**
 * 信任 HTML 边界：宿主已消毒的 HTML 片段统一经此写入。
 * - ui：`<TrustedHtml html={…} />`
 * - runtime：`applyTrustedHtml(el, html)`（runtime 唯一允许 import 的 shared/ui 模块）
 */
import type {JSX} from 'preact';

type TrustedHtmlProps = {
    html: string;
    className?: string;
} & Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    'dangerouslySetInnerHTML' | 'children'
>;

/**
 * Preact 组件：用 dangerouslySetInnerHTML 注入已消毒 HTML。
 */
export function TrustedHtml({html, className, ...rest}: TrustedHtmlProps) {
    return (
        <div
            className={className}
            {...rest}
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
}

/**
 * runtime 命令式写入：等价于组件路径的信任边界。
 *
 * namespace 名偏离文件名（TrustedHtml）：文件名与组件名冲突，按内容主体
 * （信任 HTML 的 DOM 写入面）起名。
 */
export namespace TrustedHtmlWriter {
    export function apply(el: Element, html: string): void {
        el.innerHTML = html;
    }
}
