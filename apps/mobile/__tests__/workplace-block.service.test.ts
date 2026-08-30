/**
 * workplace-block.service：手动重置 → clearSession + 清 Composer 上条。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';

const mockRefresh = jest.fn(async () => undefined);

jest.mock('@/services/project-composer-status.service', () => ({
  refreshComposerStatusAfterSessionKkvCleared: (...args: unknown[]) =>
    mockRefresh(...args),
}));

import {clearSessionWorkplaceKkv} from '@/services/workplace-block.service';

describe('workplace-block.service', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
  });

  it('clearSessionWorkplaceKkv 清空 session kkv 并刷新状态条', async () => {
    const clearSession = jest.fn(async () => undefined);
    const runtime = {sessionKkv: {clearSession}} as any;

    const block = await clearSessionWorkplaceKkv(runtime, {
      projectId: 'p',
      sessionId: 's',
    });
    expect(clearSession).toHaveBeenCalledWith('s');
    expect(mockRefresh).toHaveBeenCalledWith(runtime, {
      projectId: 'p',
      sessionId: 's',
    });
    expect(block.workplaceDisplay).toBe('');
  });
});
