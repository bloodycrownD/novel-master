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
});
