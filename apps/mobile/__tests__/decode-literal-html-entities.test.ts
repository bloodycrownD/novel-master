import {Text} from '@novel-master/core/common';
import {LiteralHtmlEntities} from '@/components/rich-content/decode-literal-html-entities';
import {TranscriptRichHtml} from '@/components/rich-content/prepare-transcript-rich-html';

describe('Text.decodeHtmlEntities', () => {
    it('decodes &quot; and double-encoded &amp;quot;', () => {
        expect(Text.decodeHtmlEntities('&quot;重新做人&quot;')).toBe('"重新做人"');
        expect(Text.decodeHtmlEntities('&amp;quot;重新做人&amp;quot;')).toBe(
            '"重新做人"',
        );
    });

    it('leaves normal Chinese quotes unchanged', () => {
        expect(Text.decodeHtmlEntities('「有意思」')).toBe('「有意思」');
    });

    it('完整解码还原尖括号实体', () => {
        expect(Text.decodeHtmlEntities('&lt;xxx&gt;')).toBe('<xxx>');
    });

    it('decodeAfterSanitize 保留尖括号实体并仍解 quot', () => {
        expect(LiteralHtmlEntities.decodeAfterSanitize('&lt;xxx&gt;&amp;quot;x&amp;quot;')).toBe(
            '&lt;xxx&gt;"x"',
        );
        expect(LiteralHtmlEntities.decodeAfterSanitize('hello &lt;file&gt;a&lt;/file&gt;')).toBe(
            'hello &lt;file&gt;a&lt;/file&gt;',
        );
    });
});

describe('prepareTranscriptRichHtml entity normalization', () => {
    it('renders literal &amp;quot; in LLM prose as real quotes', () => {
        const html = TranscriptRichHtml.prepare(
            '得到了一个&amp;quot;重新做人&amp;quot;的机会',
        );
        expect(html).toContain('"重新做人"');
        expect(html).not.toContain('&quot;');
        expect(html).not.toContain('&amp;quot;');
    });

    it('markdown list with &quot; entities', () => {
        const html = TranscriptRichHtml.prepare(
            '- 得到了一个&quot;重新做人&quot;的机会\n- **有意思**',
        );
        expect(html).toContain('"重新做人"');
        expect(html).not.toMatch(/&quot;/);
    });

    it('decodes sanitize double-encoding for straight quotes in prose', () => {
        const html = TranscriptRichHtml.prepare(
            'The "Life Lake" treatment and "verification" teasing.',
        );
        expect(html).toContain('"Life Lake"');
        expect(html).toContain('"verification"');
        expect(html).not.toMatch(/&amp;quot;/);
        expect(html).not.toMatch(/&quot;/);
    });

    it('decodes &amp;quot; inside table cells', () => {
        const html = TranscriptRichHtml.prepare(
            '| 情感 | 来源 |\n| **自我厌恶** | 意识到&quot;纯洁肉体&quot;下仍是&quot;淫荡灵魂&quot; |',
        );
        expect(html).toContain('"纯洁肉体"');
        expect(html).not.toMatch(/&amp;quot;/);
        expect(html).not.toMatch(/&quot;/);
    });
});
