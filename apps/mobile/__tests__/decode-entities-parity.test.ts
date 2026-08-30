/**
 * oq14/align-tests：双端双份实现的对齐守护。
 *
 * 1) decode-literal-html-entities（RN 侧）与 src/web/shared/decode-entities
 *    （WebView 侧）同输入同输出一致性快照。
 * 2) LANG_ALIAS（mobile highlight-code.ts）与 desktop FENCE_LANG_ALIAS
 *    （apps/desktop/renderer/components/code-block.tsx）表内容一致性。
 *    desktop 侧为模块私有 const 且位于 tsx renderer（无法从 mobile jest 跨包
 *    import），故以 FENCE_LANG_ALIAS_FIXTURE 夹具双写。
 *
 * 同步义务：任一端（mobile LANG_ALIAS / desktop FENCE_LANG_ALIAS）增删语言
 * 别名时，必须同步更新另一端与本夹具，三处保持同一张表（T-CB13 契约）。
 */
import {
  decodeAfterSanitize as rnDecodeAfterSanitize,
  decodeForMarkdownInput as rnDecodeForMarkdown,
  decodeLiteralHtmlEntities as rnDecode,
} from '@/components/rich-content/decode-literal-html-entities';
import {
  decodeAfterSanitize as webDecodeAfterSanitize,
  decodeForMarkdownInput as webDecodeForMarkdown,
  decodeLiteralHtmlEntities as webDecode,
} from '@/web/shared/decode-entities';
import {LANG_ALIAS} from '@/components/rich-content/highlight-code';

/** desktop `apps/desktop/renderer/components/code-block.tsx` 的 FENCE_LANG_ALIAS 双写副本。 */
const FENCE_LANG_ALIAS_FIXTURE: Record<string, string> = {
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  python: 'python',
  py: 'python',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  sql: 'sql',
  markdown: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  css: 'css',
  json: 'json',
};

const SAMPLES = [
  '',
  '「有意思」',
  '&quot;重新做人&quot;',
  '&amp;quot;重新做人&amp;quot;',
  '&amp;amp;still&amp;amp;',
  '&apos;quote&apos;',
  '&#34;num&#34;',
  '&#x22;hex&#x22;',
  '&#39;num-apos&#39;',
  '&#x27;hex-apos&#x27;',
  '&lt;file&gt;a&lt;/file&gt;',
  '&amp;lt;double&amp;gt;',
  '&#60;num-lt&#62;',
  '&#x3c;hex-lt&#x3e;',
  '得到了一个&amp;quot;机会&apos;&lt;是真的&gt;',
  '&QUOT;大写实体&AMP;quot;',
];

describe('oq14 decode-entities 双端对齐', () => {
  it('同输入同输出：decodeLiteralHtmlEntities 默认（含尖括号）', () => {
    for (const sample of SAMPLES) {
      expect(rnDecode(sample)).toBe(webDecode(sample));
    }
  });

  it('同输入同输出：preserveAngleBrackets（sanitize 出口形态）', () => {
    for (const sample of SAMPLES) {
      expect(rnDecode(sample, {preserveAngleBrackets: true})).toBe(
        webDecode(sample, {preserveAngleBrackets: true}),
      );
    }
  });

  it('同输入同输出：入口/出口包装函数', () => {
    for (const sample of SAMPLES) {
      expect(rnDecodeForMarkdown(sample)).toBe(webDecodeForMarkdown(sample));
      expect(rnDecodeAfterSanitize(sample)).toBe(webDecodeAfterSanitize(sample));
    }
  });

  it('双端输出一致性快照（人为改任一侧实现即变红）', () => {
    const rows = SAMPLES.map(sample => ({
      input: sample,
      full: rnDecode(sample),
      preserveAngle: rnDecode(sample, {preserveAngleBrackets: true}),
      webFull: webDecode(sample),
      webPreserveAngle: webDecode(sample, {preserveAngleBrackets: true}),
    }));
    expect(rows).toMatchSnapshot();
  });

  it('web 侧对非 string 输入的容错不改变 string 输入的对齐结果', () => {
    // web 签名是 unknown；对 string 输入两侧行为必须一致（对齐基线）
    expect(webDecode('&lt;x&gt;')).toBe(rnDecode('&lt;x&gt;'));
  });
});

describe('oq14 LANG_ALIAS × desktop FENCE_LANG_ALIAS 对齐', () => {
  it('mobile LANG_ALIAS 与 desktop FENCE_LANG_ALIAS 夹具逐项相等', () => {
    expect(LANG_ALIAS).toEqual(FENCE_LANG_ALIAS_FIXTURE);
    // 双向无孤儿键（toEqual 已覆盖，显式计数钉住表规模防静默缩水）
    expect(Object.keys(LANG_ALIAS)).toHaveLength(19);
  });
});
