/**
 * rich-document 整页视图：主题 CSS 变量由 runtime applyTheme 写入；
 * 本组件负责文档结构；frontMatterHtml 一律走 TrustedHtml。
 * plain 认锚：带锚 HTML 经 TrustedHtml（禁止文本节点露出裸 `<span>`）。
 *
 * 分支选择收敛在 buildDocumentBody（纯函数，合约测试直测）：
 * - html 分支：FM + 富文本正文拼成同一条 HTML 整体 TrustedHtml（Recogito 挂载点
 *   与偏移量基准覆盖 FM）；over-limit 回退时 FM 卡片不会凭空消失。
 * - plain 分支：FM 单独 TrustedHtml，正文是文本节点按原文显示——FM 不得拼进
 *   文本节点，否则 `<div class="fm-card">` 会按字面透出（2026-09-19 修复的回归）。
 */
import type {ComponentChildren} from 'preact';
import {TrustedHtml} from '@web/shared/ui/TrustedHtml';
import {
  OVER_LIMIT_HINT,
  buildDocumentBody,
  type DocumentPayload,
} from '../runtime/document-model';

export type DocumentAppProps = {
  payload: DocumentPayload;
};

/** 落 `.doc-body` 的 class（HTML 布局按 payload.layout 区分富/纯）。 */
function docBodyClass(layout: 'plain' | 'rich' | undefined): string {
  return layout === 'plain' ? 'doc-body' : 'doc-body rich';
}

export function DocumentApp({payload}: DocumentAppProps) {
  const bodyDesc = buildDocumentBody(payload);
  const overLimit = !!payload.overLimit;

  let body: ComponentChildren = null;
  if (bodyDesc?.kind === 'html') {
    body = (
      <TrustedHtml
        html={bodyDesc.html}
        className={docBodyClass(bodyDesc.layout)}
      />
    );
  } else if (bodyDesc) {
    body = (
      <div className="doc-body">
        {bodyDesc.fmHtml ? <TrustedHtml html={bodyDesc.fmHtml} /> : null}
        {bodyDesc.text}
      </div>
    );
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
