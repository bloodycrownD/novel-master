/**
 * rich-document 整页视图：主题 CSS 变量由 runtime applyTheme 写入；
 * 本组件负责文档结构；富片段与 frontMatterHtml 一律走 TrustedHtml。
 * plain 认锚：带锚 HTML 经 TrustedHtml（禁止文本节点露出裸 `<span>`）。
 *
 * html / plain 两个分支都通过 concatDocBodyHtml 把 FM HTML 拼进 .doc-body 内部
 * （置于正文之前），over-limit 回退时 FM 卡片不会凭空消失。
 */
import type { ComponentChildren } from 'preact';
import { TrustedHtml } from '@web/shared/ui/TrustedHtml';
import {
  OVER_LIMIT_HINT,
  concatDocBodyHtml,
  type DocumentPayload,
} from '../runtime/document-model';

export type DocumentAppProps = {
  payload: DocumentPayload;
};

/** 落 `.doc-body` 的 class（HTML 布局按 payload.layout 区分富/纯）。 */
function docBodyClass(layout: 'plain' | 'rich' | undefined): string {
  return layout === 'plain' ? 'doc-body' : 'doc-body rich';
}

export function DocumentApp({ payload }: DocumentAppProps) {
  const fm = payload.frontMatterHtml || '';
  const mode = payload.mode;
  const overLimit = !!payload.overLimit;

  let body: ComponentChildren = null;
  if (mode === 'html' && payload.html) {
    // FM HTML 并入 .doc-body 内部（置于正文之前），让 Recogito 挂载点与偏移量基准覆盖 FM
    body = (
      <TrustedHtml
        html={concatDocBodyHtml(fm, payload.html)}
        className={docBodyClass(payload.layout)}
      />
    );
  } else if (payload.plain) {
    // 无锚纯文本回退（over-limit / 非 annotate 预览）；FM 同样并入 .doc-body 内、置于纯文本之前
    body = <div className="doc-body">{concatDocBodyHtml(fm, payload.plain)}</div>;
  }

  const children: ComponentChildren[] = [];
  if (body) {
    children.push(body);
  }
  if (overLimit) {
    children.push(<div className="over-limit-hint">{OVER_LIMIT_HINT}</div>);
  }
  return children;
}
