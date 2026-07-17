/**
 * rich-document 整页视图：主题 CSS 变量由 runtime applyTheme 写入；
 * 本组件负责文档结构；富片段与 frontMatterHtml 一律走 TrustedHtml。
 */
import { h } from 'preact';
import type { ComponentChildren } from 'preact';
import { TrustedHtml } from '@web/shared/ui/TrustedHtml';
import {
  OVER_LIMIT_HINT,
  type DocumentPayload,
} from '../runtime/document-model';

export type DocumentAppProps = {
  payload: DocumentPayload;
};

export function DocumentApp({ payload }: DocumentAppProps) {
  const fm = payload.frontMatterHtml || '';
  const mode = payload.mode;
  const overLimit = !!payload.overLimit;

  let body: ComponentChildren = null;
  if (mode === 'html' && payload.html) {
    body = <TrustedHtml html={payload.html} className="doc-body rich" />;
  } else if (payload.plain) {
    body = <div className="doc-body">{payload.plain}</div>;
  }

  const children: ComponentChildren[] = [];
  if (fm) {
    children.push(<TrustedHtml html={fm} />);
  }
  if (body) {
    children.push(body);
  }
  if (overLimit) {
    children.push(<div className="over-limit-hint">{OVER_LIMIT_HINT}</div>);
  }
  return children;
}
