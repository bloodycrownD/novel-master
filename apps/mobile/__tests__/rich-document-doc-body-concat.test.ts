/**
 * T-FA4：DocumentApp 合并渲染合约测试 —— FM + body 同在 .doc-body。
 *
 * DocumentApp 是 rich-document WebView 内组件，不能直接在 RN Jest 环境渲染
 * （依赖 preact + @web 别名 + TrustedHtml 的 dangerouslySetInnerHTML）。
 * 因此把「FM 拼接进 .doc-body 正文前置」的逻辑收敛成纯函数 concatDocBodyHtml，
 * 本用例直接断言其拼接语义，并从 webview-dist 产物断言 DocumentApp 的
 * html / plain 两个分支在 build 后都经由它拼接（而非常量硬编码），
 * 确保 over-limit 回退时 FM 卡片不会凭空消失。
 */
import { concatDocBodyHtml } from '../src/web/rich-document/webview/runtime/document-model';
import { readWebViewDistFile } from './helpers/read-webview-dist';

describe('concatDocBodyHtml (T-FA4 fm+body 并入 .doc-body)', () => {
  it('有 FM 时把 FM 置于正文之前、拼成同一条 HTML', () => {
    const fm = '<div class="fm-card"><h1>title</h1></div>';
    const body = '<p>正文段落</p>';
    expect(concatDocBodyHtml(fm, body)).toBe(`${fm}${body}`);
  });

  it('无 FM 时原样返回正文', () => {
    const body = '<p>仅正文</p>';
    expect(concatDocBodyHtml('', body)).toBe(body);
  });

  it('FM 串与 body 串落在同一条字符串里，且顺序为 FM 在前', () => {
    const fm = '<div class="fm-card"/>';
    const body = '<p>正文</p>';
    const merged = concatDocBodyHtml(fm, body);
    expect(merged).toContain('fm-card');
    expect(merged).toContain('<p>正文</p>');
    expect(merged.indexOf('fm-card')).toBeLessThan(merged.indexOf('<p>正文</p>'));
  });

  it('DocumentApp 的 html / plain 两分支在 WebView 产物中都调用 concatDocBodyHtml', () => {
    const script = readWebViewDistFile('rich-document', 'app.js');
    // 两个调用点：html 分支（TrustedHtml）与 plain 分支（doc-body 纯文本前置）
    const callCount = script.split('concatDocBodyHtml').length - 1;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
