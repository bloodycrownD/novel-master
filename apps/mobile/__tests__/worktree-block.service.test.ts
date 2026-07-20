/**
 * worktree-block.service：手动重置 → clearSession + 清 Composer 上条。
 */
import { describe, expect, it, jest } from '@jest/globals';

const mockRefresh = jest.fn(async () => undefined);

jest.mock('../src/services/project-composer-status.service', () => ({
  refreshComposerStatusAfterSessionKkvCleared: (...args: unknown[]) =>
    mockRefresh(...args),
}));

import { clearSessionWorkplaceKkv } from '../src/services/worktree-block.service';

describe('worktree-block.service', () => {
  it('clearSessionWorkplaceKkv 清空 session kkv 并刷新状态条', async () => {
    const clearSession = jest.fn(async () => undefined);
    const runtime = { sessionKkv: { clearSession } } as any;
    mockRefresh.mockClear();

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
