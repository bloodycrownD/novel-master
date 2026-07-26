/**
 * T-CR5：置位/压缩 refresh 推 project∪annotate；Undo 路径仍可先空。
 * 投影读 UserOpsLogStore（不再 preview 净 diff）。
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  appendUserOpsLog,
  resetUserOpsLogStoreForTests,
} from '@novel-master/core/chat';

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
    resetUserOpsLogStoreForTests();
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
    appendUserOpsLog('s1', {
      id: 'uol-keep',
      createdAtMs: 1,
      actionXml: `<action name="mkdir">\n${JSON.stringify({ path: '/keep' }, null, 2)}\n</action>`,
      action: 'mkdir',
      path: '/keep',
    });
    await refreshComposerStatusAfterFloorOrCompaction({} as any, {
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
