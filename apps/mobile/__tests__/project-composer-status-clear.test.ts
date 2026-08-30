/**
 * T-CR5：置位/压缩 refresh 推仅 annotate 投影；Undo 路径仍可先空。
 */
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {addChatAnnotateDraft} from '@novel-master/core/chat';
import {resetChatAnnotateDraftStoreForTests} from '@/storage/chat-annotate-draft';

const mockReplace = jest.fn();

jest.mock('@/storage/chat-composer-draft', () => ({
  applyComposerStatusAttachmentsReplace: (...args: unknown[]) =>
    mockReplace(...args),
}));

import {
  refreshComposerStatusAfterFloorOrCompaction,
  refreshComposerStatusAfterSessionKkvCleared,
} from '@/services/project-composer-status.service';

describe('composer status after kkv clear (T-CR5)', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    resetChatAnnotateDraftStoreForTests();
  });

  it('Undo/手动：refreshComposerStatusAfterSessionKkvCleared 以空 attachments 替换', async () => {
    await refreshComposerStatusAfterSessionKkvCleared({} as any, {
      projectId: 'p',
      sessionId: 's1',
    });
    expect(mockReplace).toHaveBeenCalledWith({
      sessionId: 's1',
      attachments: [],
    });
  });

  it('T-CR5: 置位/压缩 refreshComposerStatusAfterFloorOrCompaction 推仅 annotate 投影（非强制 []）', async () => {
    addChatAnnotateDraft('s1', {
      id: 'a-keep',
      path: '/keep.md',
      originalText: 'k',
      userAnnotation: '批注',
    });
    await refreshComposerStatusAfterFloorOrCompaction({} as any, {
      projectId: 'p',
      sessionId: 's1',
    });
    expect(mockReplace).toHaveBeenCalledWith({
      sessionId: 's1',
      attachments: [
        {
          name: '/keep.md',
          source: 'user_ops',
          type: 'text',
          content: null,
          path: '/keep.md',
          action: 'annotate',
        },
      ],
    });
  });
});
