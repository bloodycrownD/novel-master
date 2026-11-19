/**
 * Front Matter card HTML for RichDocumentWebView — mirrors RN FrontMatterCard layout
 * so FM and markdown body share one #doc scroll container.
 */
import {Html} from '@/components/common/html';

type FrontMatterDocumentInput = {
  readonly fields: readonly {readonly key: string; readonly value: string}[];
  readonly empty: boolean;
};

// 文件名带动词 build，按内容主体起名 FrontMatterDocumentHtml。
export namespace FrontMatterDocumentHtml {
  /** Sanitized FM block; empty string when there is nothing to show. */
  export function build(input: FrontMatterDocumentInput): string {
    const hasContent = input.empty || input.fields.length > 0;
    if (!hasContent) {
      return '';
    }

    let html = '<div class="fm-card"><div class="fm-title">Front Matter</div>';
    if (input.empty) {
      html += '<div class="fm-empty">（空 Front Matter）</div>';
    }
    if (!input.empty) {
      for (const field of input.fields) {
        html += '<div class="fm-row">';
        if (field.key) {
          html += `<div class="fm-key">${Html.escape(field.key)}</div>`;
        }
        html += `<div class="fm-value">${Html.escape(field.value)}</div>`;
        html += '</div>';
      }
    }
    html += '</div>';
    return html;
  }
}
