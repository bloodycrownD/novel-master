/**
 * Mobile annotate store + 状态条 ∪（T-AN1 / T-AN2 / T-AN4）。
 */
import {describe, expect, it, afterEach} from '@jest/globals';
import {hasComposerSendableInput} from '@novel-master/core/chat';
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  removeChatAnnotateDraftsByPath,
  resetChatAnnotateDraftStoreForTests,
} from '../src/storage/chat-annotate-draft';

afterEach(() => {
  resetChatAnnotateDraftStoreForTests();
});

describe('chat-annotate-draft', () => {
  it('T-AN1: 同 path 两条批注仅一只 chip', () => {
    const sessionId = 's-an1-m-agg';
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path: '/c.md',
      originalText: 'foo',
      userAnnotation: 'note1',
    });
    addChatAnnotateDraft(sessionId, {
      id: 'a2',
      path: '/c.md',
      originalText: 'bar',
      userAnnotation: 'note2',
    });
    const chips = chipsFromAnnotateStore(sessionId);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.action).toBe('annotate');
    expect(chips[0]?.path).toBe('/c.md');
    expect(listChatAnnotateDrafts(sessionId)).toHaveLength(2);
  });

  it('T-AN2: 删光 path 后 chip 消失', () => {
    const sessionId = 's-an2-m';
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path: '/gone.md',
      originalText: 'a',
      userAnnotation: 'b',
    });
    removeChatAnnotateDraftsByPath(sessionId, '/gone.md');
    expect(chipsFromAnnotateStore(sessionId)).toHaveLength(0);
    expect(hasChatAnnotateDrafts(sessionId)).toBe(false);
  });

  it('T-AN3: 未 clear 则草稿保留；clear 后清空', () => {
    const sessionId = 's-an3-m';
    addChatAnnotateDraft(sessionId, {
      id: 'a1',
      path: '/keep.md',
      originalText: 'x',
      userAnnotation: 'y',
    });
    expect(hasChatAnnotateDrafts(sessionId)).toBe(true);
    clearChatAnnotateDrafts(sessionId);
    expect(hasChatAnnotateDrafts(sessionId)).toBe(false);
  });

  it('T-AN4: 仅 hasAnnotateDrafts → hasComposerSendableInput 可发', () => {
    expect(
      hasComposerSendableInput({
        text: '',
        attachmentCount: 0,
        hasPendingUserOps: false,
        hasWorkplaceDelta: false,
      }),
    ).toBe(false);
    expect(
      hasComposerSendableInput({
        text: '',
        attachmentCount: 0,
        hasPendingUserOps: false,
        hasWorkplaceDelta: false,
        hasAnnotateDrafts: true,
      }),
    ).toBe(true);
  });
});
