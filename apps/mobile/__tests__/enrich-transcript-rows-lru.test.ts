/**
 * comp-chat/C-6：richHtmlCache 有界 LRU。
 * - 超过 500 条后最旧条目被淘汰，再次命中时重算
 * - 「缓存空串按 miss」语义保留：prepare 返回 undefined 时缓存空串、
 *   二次命中不重算且 textHtml 仍为 undefined
 */
import {jest} from '@jest/globals';
import {EnrichTranscriptRows} from '@/components/chat/enrich-transcript-rows'
import type {TranscriptRow} from '@/components/chat/ChatTranscriptBridge';

const mockPrepare = jest.fn((content: string) => `<p>${content}</p>`);

jest.mock('@/components/rich-content/prepare-transcript-rich-html', () => {
  const legacy = {
  prepareTranscriptRichHtml: (content: string) => mockPrepare(content),
};
  return {...legacy, TranscriptRichHtml: {prepare: legacy.prepareTranscriptRichHtml}};
});

function assistantRow(id: string, text: string): TranscriptRow {
  return {
    kind: 'message',
    id,
    role: 'assistant',
    hidden: false,
    text,
    thinking: '',
  };
}

describe('enrichTranscriptRows richHtmlCache LRU', () => {
  beforeEach(() => {
    EnrichTranscriptRows.clearRichHtmlCacheForTests();
    mockPrepare.mockClear();
    mockPrepare.mockImplementation((content: string) => `<p>${content}</p>`);
  });

  it('超过 500 条后最旧条目被淘汰，再访问时重算', () => {
    const rows = Array.from({length: 501}, (_, i) =>
      assistantRow(`m${i}`, `body-${i}`),
    );
    EnrichTranscriptRows.enrich(rows, true);
    expect(mockPrepare).toHaveBeenCalledTimes(501);

    // 第一条已被 LRU 淘汰：再 enrich 时需重算且结果正确。
    const [again] = EnrichTranscriptRows.enrich([rows[0]!], true);
    expect(again.kind).toBe('message');
    if (again.kind === 'message') {
      expect(again.textHtml).toBe('<p>body-0</p>');
    }
    expect(mockPrepare).toHaveBeenCalledTimes(502);
  });

  it('缓存空串按 miss：prepare 返回 undefined 时不重算、textHtml 保持 undefined', () => {
    mockPrepare.mockImplementation(() => undefined);
    const row = assistantRow('m-plain', 'plain');
    const [first] = EnrichTranscriptRows.enrich([row], true);
    expect(first.kind).toBe('message');
    if (first.kind === 'message') {
      expect(first.textHtml).toBeUndefined();
    }
    expect(mockPrepare).toHaveBeenCalledTimes(1);

    // 二次命中缓存里的空串：不重算，行为等价 miss（undefined）。
    const [second] = EnrichTranscriptRows.enrich([row], true);
    expect(second.kind).toBe('message');
    if (second.kind === 'message') {
      expect(second.textHtml).toBeUndefined();
    }
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });
});
