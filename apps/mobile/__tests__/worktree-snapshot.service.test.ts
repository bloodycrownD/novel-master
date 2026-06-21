import {describe, expect, it, jest} from '@jest/globals';
import {
  getOrRefreshSessionWorktreeSnapshot,
  invalidateSessionWorktreeSnapshot,
} from '../src/services/worktree-snapshot.service';

describe('worktree-snapshot.service', () => {
  it('getOrRefresh delegates to worktreeSnapshot store', async () => {
    const materializePersistBlock = jest.fn(async () => ({
      worktreeDisplay: 'wt',
    }));
    const getOrRefresh = jest.fn(async (_p, _s, loader) => {
      const rendered = await loader();
      return {
        worktreeDisplay: rendered.worktreeDisplay,
        refreshedAtMs: Date.now(),
      };
    });
    const runtime = {
      worktreeSnapshot: {getOrRefresh, markDirty: jest.fn()},
      worktree: () => ({materializePersistBlock}),
    };

    const snap = await getOrRefreshSessionWorktreeSnapshot(runtime as any, {
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(snap.worktreeDisplay).toBe('wt');
    expect(snap.refreshedAtMs).toBeGreaterThan(0);
    expect(getOrRefresh).toHaveBeenCalledWith('p1', 's1', expect.any(Function));
    expect(materializePersistBlock).toHaveBeenCalledTimes(1);
  });

  it('invalidate marks session dirty', () => {
    const markDirty = jest.fn();
    const runtime = {
      worktreeSnapshot: {markDirty},
    };
    invalidateSessionWorktreeSnapshot(runtime as any, 'p1', 's1');
    expect(markDirty).toHaveBeenCalledWith('p1', 's1');
  });
});
