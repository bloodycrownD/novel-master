import {describe, expect, it, jest} from '@jest/globals';

import {captureSessionWorktreeBlockForMobile} from '../src/services/worktree-block.service';

describe('worktree-block.service', () => {
  it('T-WEC4b: captureSessionWorktreeBlockForMobile 写入 block store', async () => {
    const blockStore = {
      capture: jest.fn(),
      getCapturedBlock: jest.fn(() => ({
        worktreeDisplay: 'mock-body',
        capturedAtMs: 1,
      })),
    };
    const materializePersistBlock = jest.fn(async () => ({
      worktreeDisplay: 'mock-body',
    }));
    const runtime = {
      worktreeBlockStore: blockStore,
      worktree: () => ({materializePersistBlock}),
    };

    const block = await captureSessionWorktreeBlockForMobile(runtime as any, {
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(block.worktreeDisplay).toBe('mock-body');
    expect(materializePersistBlock).toHaveBeenCalledTimes(1);
    expect(blockStore.capture).toHaveBeenCalledWith('p1', 's1', {
      worktreeDisplay: 'mock-body',
    });
  });
});
