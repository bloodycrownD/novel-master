/**
 * Front Matter card HTML for RichDocumentWebView — mirrors RN FrontMatterCard layout
 * so FM and markdown body share one #doc scroll container.
 */

export type FrontMatterDocumentInput = {
  readonly fields: readonly {readonly key: string; readonly value: string}[];
  readonly invalid: boolean;
  readonly empty: boolean;
  readonly rawLines?: readonly string[];
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Sanitized FM block; empty string when there is nothing to show. */
export function buildFrontMatterDocumentHtml(
  input: FrontMatterDocumentInput,
): string {
  const hasContent =
    input.invalid ||
    input.empty ||
    input.fields.length > 0 ||
    (input.rawLines?.length ?? 0) > 0;
  if (!hasContent) {
    return '';
  }

  let html = '<div class="fm-card"><div class="fm-title">Front Matter</div>';
  if (input.invalid) {
    html +=
      '<div class="fm-error">格式无效：缺少结束的 --- 分隔线</div>';
  }
  if (input.empty) {
    html += '<div class="fm-empty">（空 Front Matter）</div>';
  }
  if (!input.invalid && !input.empty) {
    for (const field of input.fields) {
      html += '<div class="fm-row">';
      if (field.key) {
        html += `<div class="fm-key">${escapeHtml(field.key)}</div>`;
      }
      html += `<div class="fm-value">${escapeHtml(field.value)}</div>`;
      html += '</div>';
    }
  }
  if (input.invalid && input.rawLines?.length) {
    for (const line of input.rawLines) {
      html += `<div class="fm-value fm-mono">${escapeHtml(line)}</div>`;
    }
  }
  html += '</div>';
  return html;
}
