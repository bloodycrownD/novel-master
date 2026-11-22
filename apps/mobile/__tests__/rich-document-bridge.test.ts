import {richDocumentBridge, RICH_DOCUMENT_BRIDGE_VERSION} from '@/components/vfs/RichDocumentBridge';

describe('rich-document-bridge', () => {
    it('round-trips RN→Web setDocument envelope', () => {
        const message = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'setDocument' as const,
            payload: {
                mode: 'html' as const,
                html: '<p>hello</p>',
                overLimit: false,
            },
        };
        const raw = richDocumentBridge.encodeToClient(message);
        const parsed = richDocumentBridge.decodeToClient(raw);
        expect(parsed).toEqual(message);
    });

    it('round-trips Web→RN ready envelope', () => {
        const message = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'ready' as const,
            payload: {version: 1},
        };
        const raw = richDocumentBridge.encodeToHost(message);
        const parsed = richDocumentBridge.decodeToHost(raw);
        expect(parsed).toEqual(message);
    });

    it('round-trips plain overLimit setDocument', () => {
        const message = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'setDocument' as const,
            payload: {
                mode: 'plain' as const,
                plain: 'x'.repeat(13_000),
                overLimit: true,
            },
        };
        expect(richDocumentBridge.decodeToClient(richDocumentBridge.encodeToClient(message))).toEqual(
            message,
        );
    });

    it('round-trips setAnnotateEnabled / setAnnotations', () => {
        const enabled = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'setAnnotateEnabled' as const,
            payload: {enabled: true},
        };
        expect(richDocumentBridge.decodeToClient(richDocumentBridge.encodeToClient(enabled))).toEqual(
            enabled,
        );
        const marks = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'setAnnotations' as const,
            payload: {
                annotations: [
                    {
                        id: 'a1',
                        originalText: 'hello',
                        startLine: 1,
                        endLine: 3,
                    },
                ],
                sourceText: 'line1\nhello\nline3\n',
            },
        };
        expect(richDocumentBridge.decodeToClient(richDocumentBridge.encodeToClient(marks))).toEqual(
            marks,
        );
    });

    it('round-trips selectionCollect / annotateOpen', () => {
        const collect = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'selectionCollect' as const,
            payload: {
                originalText: '选中原文',
                mode: 'markdown' as const,
                contextBefore: '前',
                contextAfter: '后',
            },
        };
        expect(richDocumentBridge.decodeToHost(richDocumentBridge.encodeToHost(collect))).toEqual(
            collect,
        );
        const open = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'annotateOpen' as const,
            payload: {ids: ['a1', 'a2']},
        };
        expect(richDocumentBridge.decodeToHost(richDocumentBridge.encodeToHost(open))).toEqual(
            open,
        );
    });

    it('round-trips legacy selectionAnnotate', () => {
        const sel = {
            v: RICH_DOCUMENT_BRIDGE_VERSION,
            type: 'selectionAnnotate' as const,
            payload: {text: '选中原文'},
        };
        expect(richDocumentBridge.decodeToHost(richDocumentBridge.encodeToHost(sel))).toEqual(
            sel,
        );
    });

    it('rejects invalid bridge version', () => {
        expect(() =>
            richDocumentBridge.decodeToHost(
                JSON.stringify({v: 99, type: 'ready', payload: {version: 1}}),
            ),
        ).toThrow(/version/i);
    });
});
