import { describe, expect, it, jest } from '@jest/globals';

import {
  captureAfterManualCompactionEmit,
  captureSessionWorktreeBlockForMobile,
  captureSessionWorktreeBlockOnManualRefresh,
  getCapturedBlockOrCaptureForMobile,
} from '../src/services/worktree-block.service';

describe('worktree-block.service', () => {
  it('captureSessionWorktreeBlockForMobile 写入 block store', async () => {
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
      worktree: () => ({ materializePersistBlock }),
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

  it('T-WEC8: captureSessionWorktreeBlockOnManualRefresh 委托 capture', async () => {
    const blockStore = {
      capture: jest.fn(),
      getCapturedBlock: jest.fn(() => ({
        worktreeDisplay: 'manual-body',
        capturedAtMs: 2,
      })),
    };
    const materializePersistBlock = jest.fn(async () => ({
      worktreeDisplay: 'manual-body',
    }));
    const runtime = {
      worktreeBlockStore: blockStore,
      worktree: () => ({ materializePersistBlock }),
    };

    const block = await captureSessionWorktreeBlockOnManualRefresh(
      runtime as any,
      {
        projectId: 'p1',
        sessionId: 's1',
      },
    );

    expect(block.worktreeDisplay).toBe('manual-body');
    expect(materializePersistBlock).toHaveBeenCalledTimes(1);
    expect(blockStore.capture).toHaveBeenCalledWith('p1', 's1', {
      worktreeDisplay: 'manual-body',
    });
  });

  it('getCapturedBlockOrCapture miss 时显式 capture', async () => {
    const materializePersistBlock = jest.fn(async () => ({
      worktreeDisplay: 'wt',
    }));
    const capture = jest.fn();
    const getCapturedBlock = jest.fn(() => undefined);
    getCapturedBlock
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => ({
        worktreeDisplay: 'wt',
        capturedAtMs: 1,
      }));
    const runtime = {
      worktreeBlockStore: { capture, getCapturedBlock },
      worktree: () => ({ materializePersistBlock }),
    };

    const block = await getCapturedBlockOrCaptureForMobile(runtime as any, {
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(block.worktreeDisplay).toBe('wt');
    expect(materializePersistBlock).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('p1', 's1', { worktreeDisplay: 'wt' });
  });

  it('T-WEC5: manual 压缩 emit 成功后 capture', async () => {
    const blockStore = {
      capture: jest.fn(),
      getCapturedBlock: jest.fn(() => ({
        worktreeDisplay: 'compact-body',
        capturedAtMs: 3,
      })),
    };
    const materializePersistBlock = jest.fn(async () => ({
      worktreeDisplay: 'compact-body',
    }));
    const runtime = {
      worktreeBlockStore: blockStore,
      worktree: () => ({ materializePersistBlock }),
    };

    await captureAfterManualCompactionEmit(
      runtime as any,
      {
        projectId: 'p1',
        sessionId: 's1',
      },
      true,
    );

    expect(materializePersistBlock).toHaveBeenCalledTimes(1);
    expect(blockStore.capture).toHaveBeenCalledWith('p1', 's1', {
      worktreeDisplay: 'compact-body',
    });
  });

  it('T-WEC5: manual 压缩 emit 失败时不 capture', async () => {
    const blockStore = {
      capture: jest.fn(),
      getCapturedBlock: jest.fn(),
    };
    const materializePersistBlock = jest.fn();
    const runtime = {
      worktreeBlockStore: blockStore,
      worktree: () => ({ materializePersistBlock }),
    };

    await captureAfterManualCompactionEmit(
      runtime as any,
      {
        projectId: 'p1',
        sessionId: 's1',
      },
      false,
    );

    expect(materializePersistBlock).not.toHaveBeenCalled();
    expect(blockStore.capture).not.toHaveBeenCalled();
  });

  it('getCapturedBlockOrCapture 有条目时不重复 capture', async () => {
    const materializePersistBlock = jest.fn(async () => ({
      worktreeDisplay: 'new',
    }));
    const capture = jest.fn();
    const getCapturedBlock = jest.fn(() => ({
      worktreeDisplay: 'cached',
      capturedAtMs: 1,
    }));
    const runtime = {
      worktreeBlockStore: { capture, getCapturedBlock },
      worktree: () => ({ materializePersistBlock }),
    };

    const block = await getCapturedBlockOrCaptureForMobile(runtime as any, {
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(block.worktreeDisplay).toBe('cached');
    expect(materializePersistBlock).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});
