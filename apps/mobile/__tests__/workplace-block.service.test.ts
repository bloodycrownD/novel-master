/**
 * workplace-block.service：手动重置 → clearSession + 清 Composer 上条。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';

const mockRefresh = jest.fn(async () => undefined);

jest.mock('@/services/project-composer-status.service', () => {
    const legacy = {
    refreshComposerStatusAfterSessionKkvCleared: (...args: unknown[]) =>
        mockRefresh(...args),
};
    return {...legacy, ProjectComposerStatusService: {refreshAfterSessionKkvCleared: legacy.refreshComposerStatusAfterSessionKkvCleared}};
});

import {WorkplaceBlockService} from '@/services/workplace-block.service'

describe('workplace-block.service', () => {
    beforeEach(() => {
        mockRefresh.mockClear();
    });

    it('clearSessionWorkplaceKkv 清空 session kkv 并刷新状态条', async () => {
        const clearSession = jest.fn(async () => undefined);
        const runtime = {sessionKkv: {clearSession}} as any;

        const block = await WorkplaceBlockService.clearSessionKkv(runtime, {
            projectId: 'p',
            sessionId: 's',
        });
        expect(clearSession).toHaveBeenCalledWith('s');
        // 十七期第2轮签名审计：refresh 的 runtime 首参是死参已删，scope 形状不变。
        expect(mockRefresh).toHaveBeenCalledWith({
            projectId: 'p',
            sessionId: 's',
        });
        expect(block.workplaceDisplay).toBe('');
    });
});
