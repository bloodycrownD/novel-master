/**
 * T-FA4：DocumentApp 落 `.doc-body` 的分支合约测试。
 *
 * DocumentApp 是 rich-document WebView 内组件，不能直接在 RN Jest 环境渲染
 * （依赖 preact + @web 别名 + TrustedHtml 的 dangerouslySetInnerHTML）。
 * 因此把分支选择收敛成纯函数 buildDocumentBody，本用例直测其语义：
 * - html 分支：FM 与富文本正文拼成同一条 HTML（整体经 TrustedHtml），
 *   over-limit 回退时 FM 卡片不会凭空消失；
 * - plain 分支：FM 与正文分离——FM 是 HTML 串须单独经 TrustedHtml，正文保持
 *   文本节点。把 fmHtml 拼进 text 会按字面透出 `<div class="fm-card">`
 *   （2026-09-19 修复的回归，此处为守卫断言）。
 * 并从 webview-dist 产物断言 DocumentApp 的分支接线经由 buildDocumentBody。
 */
import {
  buildDocumentBody,
  concatDocBodyHtml,
} from '@/web/rich-document/webview/runtime/document-model';
import {readWebViewDistFile} from './helpers/read-webview-dist';

describe('concatDocBodyHtml (T-FA4 html 分支 fm+body 拼接)', () => {
  it('有 FM 时把 FM 置于正文之前、拼成同一条 HTML', () => {
    const fm = '<div class="fm-card"><h1>title</h1></div>';
    const body = '<p>正文段落</p>';
    expect(concatDocBodyHtml(fm, body)).toBe(`${fm}${body}`);
  });

  it('无 FM 时原样返回正文', () => {
    const body = '<p>仅正文</p>';
    expect(concatDocBodyHtml('', body)).toBe(body);
  });
});

describe('buildDocumentBody (T-FA4 分支选择)', () => {
  it('html 模式：FM 拼进正文 HTML、layout 透传', () => {
    const fm = '<div class="fm-card"></div>';
    const desc = buildDocumentBody({
      mode: 'html',
      html: '<p>正文</p>',
      frontMatterHtml: fm,
      layout: 'rich',
    });
    expect(desc).toEqual({kind: 'html', html: `${fm}<p>正文</p>`, layout: 'rich'});
  });

  it('plain 回退（over-limit）：fmHtml 与 text 分离，text 不得含 FM HTML', () => {
    const fm = '<div class="fm-card"><div class="fm-title">Front Matter</div></div>';
    const desc = buildDocumentBody({
      mode: 'plain',
      plain: '第1章\n正文',
      overLimit: true,
      frontMatterHtml: fm,
    });
    expect(desc).toEqual({kind: 'plain', fmHtml: fm, text: '第1章\n正文'});
    // 回归守卫：正文按原文显示，FM HTML 绝不混进文本节点
    expect(desc?.kind === 'plain' && desc.text.includes('<')).toBe(false);
  });

  it('plain 回退无 FM：fmHtml 为空串、正文原样', () => {
    const desc = buildDocumentBody({mode: 'plain', plain: '仅正文'});
    expect(desc).toEqual({kind: 'plain', fmHtml: '', text: '仅正文'});
  });

  it('无 html 且无 plain 时返回 null', () => {
    expect(buildDocumentBody({mode: 'html', frontMatterHtml: '<div/>'})).toBeNull();
    expect(buildDocumentBody({})).toBeNull();
  });

  it('DocumentApp 分支接线在 WebView 产物中经由 buildDocumentBody', () => {
    const script = readWebViewDistFile('rich-document', 'app.js');
    const callCount = script.split('buildDocumentBody').length - 1;
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});
