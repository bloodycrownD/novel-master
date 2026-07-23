import {
  decodeHostToRichDocument,
  decodeRichDocumentToHost,
  encodeHostToRichDocument,
  encodeRichDocumentToHost,
  RICH_DOCUMENT_BRIDGE_VERSION,
} from '../src/components/vfs/RichDocumentBridge';

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
    const raw = encodeHostToRichDocument(message);
    const parsed = decodeHostToRichDocument(raw);
    expect(parsed).toEqual(message);
  });

  it('round-trips Web→RN ready envelope', () => {
    const message = {
      v: RICH_DOCUMENT_BRIDGE_VERSION,
      type: 'ready' as const,
      payload: {version: 1},
    };
    const raw = encodeRichDocumentToHost(message);
    const parsed = decodeRichDocumentToHost(raw);
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
    expect(decodeHostToRichDocument(encodeHostToRichDocument(message))).toEqual(
      message,
    );
  });

  it('round-trips setAnnotateEnabled / setAnnotations', () => {
    const enabled = {
      v: RICH_DOCUMENT_BRIDGE_VERSION,
      type: 'setAnnotateEnabled' as const,
      payload: {enabled: true},
    };
    expect(decodeHostToRichDocument(encodeHostToRichDocument(enabled))).toEqual(
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
    expect(decodeHostToRichDocument(encodeHostToRichDocument(marks))).toEqual(
      marks,
    );
  });

  it('round-trips selectionAnnotate / annotateOpen', () => {
    const sel = {
      v: RICH_DOCUMENT_BRIDGE_VERSION,
      type: 'selectionAnnotate' as const,
      payload: {text: '选中原文'},
    };
    expect(decodeRichDocumentToHost(encodeRichDocumentToHost(sel))).toEqual(sel);
    const open = {
      v: RICH_DOCUMENT_BRIDGE_VERSION,
      type: 'annotateOpen' as const,
      payload: {ids: ['a1', 'a2']},
    };
    expect(decodeRichDocumentToHost(encodeRichDocumentToHost(open))).toEqual(
      open,
    );
  });

  it('rejects invalid bridge version', () => {
    expect(() =>
      decodeRichDocumentToHost(
        JSON.stringify({v: 99, type: 'ready', payload: {version: 1}}),
      ),
    ).toThrow(/version/i);
  });
});
