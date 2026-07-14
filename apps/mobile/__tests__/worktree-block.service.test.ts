/**
 * worktree-block.service：手动重置 → clearSession。
 */
import { describe, expect, it, jest } from '@jest/globals';
import { clearSessionWorkplaceKkv } from '../src/services/worktree-block.service';

describe('worktree-block.service', () => {
  it('clearSessionWorkplaceKkv 清空 session kkv', async () => {
    const clearSession = jest.fn(async () => undefined);
    const runtime = { sessionKkv: { clearSession } } as any;

    const block = await clearSessionWorkplaceKkv(runtime, {
      projectId: 'p',
      sessionId: 's',
    });
    expect(clearSession).toHaveBeenCalledWith('s');
    expect(block.worktreeDisplay).toBe('');
  });
});
