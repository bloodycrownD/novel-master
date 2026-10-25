/**
 * Mobile annotate store 直连 core 烟测（主测在 core；T-X2-3）。
 */
import {describe, expect, it, afterEach} from '@jest/globals';
import { chatAnnotateDraftStore, composerSendPolicy } from '@novel-master/core/chat';

afterEach(() => {
  chatAnnotateDraftStore.resetForTests();
});

describe('chat-annotate-draft wiring', () => {
  it('CRUD/chip 直连 core 可用', () => {
    const sessionId = 's-mobile-wire';
    chatAnnotateDraftStore.add(sessionId, {
      id: 'a1',
      path: '/wire.md',
      originalText: 'x',
      userAnnotation: 'y',
    });
    expect(chatAnnotateDraftStore.has(sessionId)).toBe(true);
    const chips = chatAnnotateDraftStore.chips(sessionId);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.action).toBe('annotate');
    expect(chips[0]?.path).toBe('/wire.md');
  });

  it('T-AN4: 仅 hasAnnotateDrafts → resolveComposerSendIntent 可发', () => {
    const intent = composerSendPolicy.evaluate({
      text: '',
      canResumeWithoutInput: false,
      hasAnnotateDrafts: true,
      hasModel: true,
    });
    expect(intent.hasSendable).toBe(true);
  });
});
