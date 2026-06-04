import {describe, expect, it, jest} from '@jest/globals';
import {
  getOrRefreshSessionWorktreeSnapshot,
  invalidateSessionWorktreeSnapshot,
} from '../src/services/worktree-snapshot.service';

describe('worktree-snapshot.service', () => {
  it('getOrRefresh returns cached snapshot with listRows without rematerializing', async () => {
    const materialize = jest.fn(async () => ({
      worktreeDisplay: 'wt',
      filetreeDisplay: 'ft',
      listRows: [{kind: 'dir' as const, path: '/', ruleState: '', inclusionMode: '', displayState: ''}],
    }));
    const refresh = jest.fn(async (_p, _s, loader) => loader());
    const runtime = {
      macroCache: {
        get: () => ({
          worktreeDisplay: 'cached-wt',
          filetreeDisplay: 'cached-ft',
          listRows: [
            {
              kind: 'file' as const,
              path: '/a.md',
              ruleState: '',
              inclusionMode: '',
              displayState: '',
            },
          ],
          refreshedAtMs: 1,
        }),
        refresh,
        clear: jest.fn(),
      },
      worktree: () => ({materialize}),
    };

    const snap = await getOrRefreshSessionWorktreeSnapshot(runtime as any, {
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(snap.worktreeDisplay).toBe('cached-wt');
    expect(materialize).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('getOrRefresh treats legacy snapshot without listRows as cache miss', async () => {
    const materialize = jest.fn(async () => ({
      worktreeDisplay: 'wt',
      filetreeDisplay: 'ft',
      listRows: [],
    }));
    const refresh = jest.fn(async (_p, _s, loader) => loader());
    const runtime = {
      macroCache: {
        get: () =>
          ({
            worktreeDisplay: 'legacy-wt',
            filetreeDisplay: 'legacy-ft',
            refreshedAtMs: 1,
          }) as any,
        refresh,
        clear: jest.fn(),
      },
      worktree: () => ({materialize}),
    };

    await getOrRefreshSessionWorktreeSnapshot(runtime as any, {
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(materialize).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('p1', 's1', expect.any(Function));
  });

  it('getOrRefresh materializes on cache miss', async () => {
    const materialize = jest.fn(async () => ({
      worktreeDisplay: 'wt',
      filetreeDisplay: 'ft',
      listRows: [],
    }));
    const refresh = jest.fn(async (_p, _s, loader) => loader());
    const runtime = {
      macroCache: {
        get: () => undefined,
        refresh,
        clear: jest.fn(),
      },
      worktree: () => ({materialize}),
    };

    await getOrRefreshSessionWorktreeSnapshot(runtime as any, {
      projectId: 'p1',
      sessionId: 's1',
    });

    expect(materialize).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('p1', 's1', expect.any(Function));
  });

  it('invalidate clears macro cache for session', () => {
    const clear = jest.fn();
    const runtime = {
      macroCache: {clear},
    };
    invalidateSessionWorktreeSnapshot(runtime as any, 'p1', 's1');
    expect(clear).toHaveBeenCalledWith('p1', 's1');
  });
});
