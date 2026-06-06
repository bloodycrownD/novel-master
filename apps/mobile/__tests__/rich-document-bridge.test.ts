import {
  RICH_DOCUMENT_BRIDGE_VERSION,
  decodeHostToRichDocument,
  decodeRichDocumentToHost,
  encodeHostToRichDocument,
  encodeRichDocumentToHost,
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

  it('rejects invalid bridge version', () => {
    expect(() =>
      decodeRichDocumentToHost(
        JSON.stringify({v: 99, type: 'ready', payload: {version: 1}}),
      ),
    ).toThrow(/version/i);
  });
});
