/**
 * refreshComposerStatusAfterSessionKkvCleared：清 kkv 后直接空状态条，不 project。
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockReplace = jest.fn();

jest.mock('../src/storage/chat-composer-draft', () => ({
  applyComposerStatusAttachmentsReplace: (...args: unknown[]) =>
    mockReplace(...args),
}));

import { refreshComposerStatusAfterSessionKkvCleared } from '../src/services/project-composer-status.service';

describe('refreshComposerStatusAfterSessionKkvCleared', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it('置位/清 kkv 后以空 attachments 替换状态条（禁止全量 workplace 投影）', async () => {
    await refreshComposerStatusAfterSessionKkvCleared({} as any, {
      projectId: 'p',
      sessionId: 's1',
    });
    expect(mockReplace).toHaveBeenCalledWith({
      sessionId: 's1',
      attachments: [],
    });
  });
});
