/**
 * T-CR5：置位/压缩 refresh 推 project∪annotate；Undo 路径仍可先空。
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockReplace = jest.fn();

jest.mock('../src/storage/chat-composer-draft', () => ({
  applyComposerStatusAttachmentsReplace: (...args: unknown[]) =>
    mockReplace(...args),
}));

import {
  refreshComposerStatusAfterFloorOrCompaction,
  refreshComposerStatusAfterSessionKkvCleared,
} from '../src/services/project-composer-status.service';

describe('composer status after kkv clear (T-CR5)', () => {
  beforeEach(() => {
    mockReplace.mockClear();
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

  it('T-CR5: 置位/压缩 refreshComposerStatusAfterFloorOrCompaction 推 project 结果（非强制 []）', async () => {
    const runtime = {
      userVfsTurn: {
        hasPendingTurns: async () => true,
        previewUserOpsActions: async () => [
          { action: 'mkdir', path: '/keep' },
        ],
      },
    } as any;
    await refreshComposerStatusAfterFloorOrCompaction(runtime, {
      projectId: 'p',
      sessionId: 's1',
    });
    expect(mockReplace).toHaveBeenCalledWith({
      sessionId: 's1',
      attachments: [
        {
          name: '/keep',
          source: 'user_ops',
          type: 'text',
          content: null,
          path: '/keep',
          action: 'mkdir',
        },
      ],
    });
  });
});
