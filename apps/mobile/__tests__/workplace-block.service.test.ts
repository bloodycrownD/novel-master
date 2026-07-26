/**
 * workplace-block.service：手动重置 → clearSession + clearUserOpsLog + 清 Composer 上条。
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  appendUserOpsLog,
  listUserOpsLog,
  resetUserOpsLogStoreForTests,
} from '@novel-master/core/chat';

const mockRefresh = jest.fn(async () => undefined);

jest.mock('../src/services/project-composer-status.service', () => ({
  refreshComposerStatusAfterSessionKkvCleared: (...args: unknown[]) =>
    mockRefresh(...args),
}));

import { clearSessionWorkplaceKkv } from '../src/services/workplace-block.service';

describe('workplace-block.service', () => {
  beforeEach(() => {
    resetUserOpsLogStoreForTests();
    mockRefresh.mockClear();
  });

  it('clearSessionWorkplaceKkv 清空 session kkv、手改日志并刷新状态条', async () => {
    appendUserOpsLog('s', {
      id: 'uol-1',
      createdAtMs: 1,
      actionXml: `<action name="write">\n${JSON.stringify({ path: '/a.md', content: 'x' }, null, 2)}\n</action>`,
      action: 'write',
      path: '/a.md',
      content: 'x',
    });
    const clearSession = jest.fn(async () => undefined);
    const runtime = { sessionKkv: { clearSession } } as any;

    const block = await clearSessionWorkplaceKkv(runtime, {
      projectId: 'p',
      sessionId: 's',
    });
    expect(clearSession).toHaveBeenCalledWith('s');
    expect(listUserOpsLog('s')).toEqual([]);
    expect(mockRefresh).toHaveBeenCalledWith(runtime, {
      projectId: 'p',
      sessionId: 's',
    });
    expect(block.workplaceDisplay).toBe('');
  });
});
