import {enrichTranscriptRows} from '../src/components/chat/enrich-transcript-rows';
import type {TranscriptRow} from '../src/components/chat/ChatTranscriptBridge';

describe('enrichTranscriptRows', () => {
  const baseRow: TranscriptRow = {
    kind: 'message',
    id: 'm1',
    role: 'assistant',
    hidden: false,
    text: '**hi**',
    thinking: '',
  };

  it('returns rows unchanged when richText is off', () => {
    expect(enrichTranscriptRows([baseRow], false)).toEqual([baseRow]);
  });

  it('adds textHtml for assistant rows when richText is on', () => {
    const [enriched] = enrichTranscriptRows([baseRow], true);
    expect(enriched.kind).toBe('message');
    if (enriched.kind === 'message') {
      expect(enriched.textHtml).toContain('<strong>');
      expect(enriched.textHtml).toContain('hi');
    }
  });

  it('does not enrich user rows', () => {
    const userRow: TranscriptRow = {...baseRow, role: 'user'};
    expect(enrichTranscriptRows([userRow], true)).toEqual([userRow]);
  });

  it('T-S4: richText=false 时 plain text 仍含尖括号', () => {
    const withTags: TranscriptRow = {
      ...baseRow,
      text: '表现为 <xxx></xxx> 之间没有文本',
    };
    const [out] = enrichTranscriptRows([withTags], false);
    expect(out.kind).toBe('message');
    if (out.kind === 'message') {
      expect(out.text).toContain('<xxx>');
      expect(out.text).toContain('</xxx>');
      expect(out.textHtml).toBeUndefined();
    }
  });
});
