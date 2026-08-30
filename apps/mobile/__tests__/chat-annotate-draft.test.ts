/**
 * Mobile annotate store 直连 core 烟测（主测在 core；T-X2-3）。
 */
import {describe, expect, it, afterEach} from '@jest/globals';
import {hasComposerSendableInput} from '@novel-master/core/chat';
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  hasChatAnnotateDrafts,
  resetChatAnnotateDraftStoreForTests,
} from '@novel-master/core/chat';

afterEach(() => {
  resetChatAnnotateDraftStoreForTests();
});

describe('chat-annotate-draft wiring', () => {
  it('CRUD/chip 直连 core 可用', () => {
    const sessionId = 's-mobile-wire';
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path: '/wire.md',
      originalText: 'x',
      userAnnotation: 'y',
    });
    expect(hasChatAnnotateDrafts(sessionId)).toBe(true);
    const chips = chipsFromAnnotateStore(sessionId);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.action).toBe('annotate');
    expect(chips[0]?.path).toBe('/wire.md');
  });

  it('T-AN4: 仅 hasAnnotateDrafts → hasComposerSendableInput 可发', () => {
    expect(
      hasComposerSendableInput({
        text: '',
        attachmentCount: 0,
        hasAnnotateDrafts: true,
      }),
    ).toBe(true);
  });
});
