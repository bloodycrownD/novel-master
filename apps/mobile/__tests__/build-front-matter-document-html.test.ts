import {FrontMatterDocumentHtml} from '@/components/vfs/build-front-matter-document-html';

describe('buildFrontMatterDocumentHtml', () => {
    it('renders key/value rows and escapes HTML', () => {
        const html = FrontMatterDocumentHtml.build({
            fields: [{key: 'title', value: '<script>'}],
            invalid: false,
            empty: false,
        });
        expect(html).toContain('fm-card');
        expect(html).toContain('title');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>');
    });

    it('returns empty when there is no FM content', () => {
        expect(
            FrontMatterDocumentHtml.build({
                fields: [],
                invalid: false,
                empty: false,
            }),
        ).toBe('');
    });
});
