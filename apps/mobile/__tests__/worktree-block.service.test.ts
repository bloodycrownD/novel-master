/**
 * worktree-block.service：遗留 capture 壳与手动刷新 → clearSession。
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  captureAfterManualCompactionEmit,
  captureSessionWorktreeBlockForMobile,
  captureSessionWorktreeBlockOnManualRefresh,
} from '../src/services/worktree-block.service';

describe('worktree-block.service', () => {
  it('遗留 capture 壳为无操作，不写 kkv', async () => {
    const clearSession = jest.fn(async () => undefined);
    const runtime = {
      sessionKkv: { clearSession },
      worktree: jest.fn(),
      sessionVfs: jest.fn(),
    } as any;

    const block = await captureSessionWorktreeBlockForMobile(runtime, {
      projectId: 'p',
      sessionId: 's',
    });
    expect(block.worktreeDisplay).toBe('');
    expect(clearSession).not.toHaveBeenCalled();
    expect(runtime.worktree).not.toHaveBeenCalled();
  });

  it('手动刷新 clear session kkv', async () => {
    const clearSession = jest.fn(async () => undefined);
    const runtime = { sessionKkv: { clearSession } } as any;

    const block = await captureSessionWorktreeBlockOnManualRefresh(runtime, {
      projectId: 'p',
      sessionId: 's',
    });
    expect(clearSession).toHaveBeenCalledWith('s');
    expect(block.worktreeDisplay).toBe('');
  });

  it('captureAfterManualCompactionEmit：kkv 已由 orchestrator 清空', async () => {
    const clearSession = jest.fn(async () => undefined);
    const runtime = { sessionKkv: { clearSession } } as any;
    await captureAfterManualCompactionEmit(
      runtime,
      { projectId: 'p', sessionId: 's' },
      true,
    );
    await captureAfterManualCompactionEmit(
      runtime,
      { projectId: 'p', sessionId: 's' },
      false,
    );
    expect(clearSession).not.toHaveBeenCalled();
  });
});
