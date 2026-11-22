/**
 * fix-b2-b4：批量删除中途失败的部分成功语义。
 * - deleteSelectedSessions：全部成功 / 第二个 session delete reject。
 * - handleDeleteProjects：中途 reject 后 finally 刷新仍执行。
 * 只 mock runtime 与 meta/token 服务；被测 hook、toast-message、
 * session view cache 均用真实实现。
 */
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {ToastMessage} from '@/errors/toast-message';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabScope} from '../src/screens/tabs/chat-tab/useChatTabScope';
import {SessionViewCache} from '../src/services/chat-session-view-cache';
import {ChatTranscriptScrollCache} from '../src/services/chat-transcript-scroll-cache';
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '../src/components/chat/ChatTranscriptBridge';
const transcriptScrollCacheKey = ChatTranscriptScrollCache.key;

jest.mock('../src/services/chat-agent-meta', () => {
    const legacy = {
    loadChatAgentMeta: jest.fn(async () => ({
        source: 'session',
        agentId: 'a1',
        agentName: 'Agent',
        modelLabel: 'Model',
        tokenLabel: '',
        hasDedicatedModel: false,
        modelSource: 'session',
    })),
};
    return {...legacy, ChatAgentMeta: {load: legacy.loadChatAgentMeta}};
});

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
    ChatPromptTokenLabel: {loadResilient: jest.fn(async () => '')},
    // cr2-E-2 新导出（手写 mock 需随导出面同步，缺它会炸 meta 加载链）。
    PreciseUpgrade: {cancelDelay: jest.fn(), cancel: jest.fn()},
}));

const deletedSessionIds: string[] = [];
const deletedProjectIds: string[] = [];

// 错误通道迁移二期后 get/listByProject/delete 走 Result（hook 侧 `!ok` 即 throw）。
const mockRuntime: any = {
    projects: {
        list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
        get: jest.fn(async () => ({ok: true, value: {id: 'p1', name: 'P1'}})),
        delete: jest.fn(async (id: string) => {
            deletedProjectIds.push(id);
            return {ok: true, value: undefined};
        }),
    },
    sessions: {
        listByProject: jest.fn(async () => ({
            ok: true,
            value: [
                {id: 's1', title: 'S1', updatedAtMs: 1},
                {id: 's2', title: 'S2', updatedAtMs: 2},
                {id: 's3', title: 'S3', updatedAtMs: 3},
            ],
        })),
        delete: jest.fn(async (id: string) => {
            deletedSessionIds.push(id);
            return {ok: true, value: undefined};
        }),
    },
    state: {
        getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini'),
    },
    // 批量/单删路径每删一个会话就调 manager.forgetSession（部分成功语义：
    // 中途失败时已删的照常遗忘）——缺这个成员会让首轮 delete 后就抛
    // TypeError 进 catch，测试只看到「删了 1 个」的假象（v1.5.37 发版轮补）。
    sessionStreamUnitManager: {
        forgetSession: jest.fn(),
    },
    sessionVfs: jest.fn(() => ({})),
    workplace: jest.fn(() => ({})),
    projectVfs: jest.fn(() => ({})),
};

const mockShowToast = jest.fn();
const mockRefreshScope = jest.fn(async () => undefined);
const mockExitSessionBatch = jest.fn();

function mountScope() {
    let api: ReturnType<typeof useChatTabScope> | undefined;
    function Harness() {
        api = useChatTabScope({
            runtime: mockRuntime,
            projectId: 'p1',
            sessionId: 's1',
            setCurrentProject: jest.fn(async () => undefined),
            setCurrentSession: jest.fn(async () => undefined),
            refreshScope: mockRefreshScope,
            showToast: mockShowToast,
            navigation: {navigate: jest.fn()} as any,
        });
        return null;
    }
    act(() => {
        TestRenderer.create(React.createElement(Harness));
    });
    return api!;
}

describe('useChatTabScope 批量删除中途失败', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        deletedSessionIds.length = 0;
        deletedProjectIds.length = 0;
        SessionViewCache.clearAll();
        ChatTranscriptScrollCache.clearAll();
        mockRuntime.sessions.delete.mockImplementation(async (id: string) => {
            deletedSessionIds.push(id);
            return {ok: true, value: undefined};
        });
        mockRuntime.projects.delete.mockImplementation(async (id: string) => {
            deletedProjectIds.push(id);
            return {ok: true, value: undefined};
        });
    });

    describe('deleteSelectedSessions', () => {
        it('全部成功：逐个 delete、退出批选、刷新执行', async () => {
            const s1Key = SessionViewCache.key('p1', 's1');
            SessionViewCache.set(s1Key, {messages: [], hasMoreMessages: false});
            const api = mountScope();
            const listCallsBefore = mockRuntime.projects.list.mock.calls.length;

            await act(async () => {
                await api.deleteSelectedSessions(
                    new Set(['s1', 's2', 's3']),
                    mockExitSessionBatch,
                );
            });

            expect(mockRuntime.sessions.delete.mock.calls).toEqual([
                ['s1'],
                ['s2'],
                ['s3'],
            ]);
            expect(mockExitSessionBatch).toHaveBeenCalledTimes(1);
            expect(mockRefreshScope).toHaveBeenCalledTimes(1);
            expect(mockRuntime.projects.list.mock.calls.length).toBeGreaterThan(
                listCallsBefore,
            );
            // 已删会话的视图缓存被清掉，刷新后不会复用旧消息尾。
            expect(SessionViewCache.get(s1Key)).toBeUndefined();
            expect(mockShowToast).not.toHaveBeenCalled();
        });

        it('第二个 delete reject：toast 提示、批选仍退出、第一个已删不复活', async () => {
            mockRuntime.sessions.delete.mockImplementation(async (id: string) => {
                if (id === 's2') {
                    return {ok: false as const, error: new Error('db locked')};
                }
                deletedSessionIds.push(id);
                return {ok: true, value: undefined};
            });
            const api = mountScope();

            await act(async () => {
                await api.deleteSelectedSessions(
                    new Set(['s1', 's2', 's3']),
                    mockExitSessionBatch,
                );
            });

            // 中途停止：只尝试了 s1、s2，s3 未动；s1 的删除效果保留（无回滚路径）。
            expect(mockRuntime.sessions.delete.mock.calls).toEqual([['s1'], ['s2']]);
            expect(deletedSessionIds).toEqual(['s1']);
            expect(mockShowToast).toHaveBeenCalledTimes(1);
            // 真实 ToastMessage.toast('删除失败', error) 产出「删除失败：db locked」。
            expect(mockShowToast).toHaveBeenCalledWith(
                expect.stringContaining('删除失败'),
            );
            expect(mockExitSessionBatch).toHaveBeenCalledTimes(1);
            expect(mockRefreshScope).toHaveBeenCalledTimes(1);
        });
    });

    describe('handleDeleteProjects', () => {
        it('中途 reject：toast 提示、finally 刷新仍执行', async () => {
            mockRuntime.projects.delete.mockImplementation(async (id: string) => {
                if (id === 'p2') {
                    return {ok: false as const, error: new Error('fs busy')};
                }
                deletedProjectIds.push(id);
                return {ok: true, value: undefined};
            });
            const api = mountScope();
            const listCallsBefore = mockRuntime.projects.list.mock.calls.length;

            await act(async () => {
                await api.handleDeleteProjects(['p1', 'p2', 'p3']);
            });

            expect(mockRuntime.projects.delete.mock.calls).toEqual([['p1'], ['p2']]);
            expect(deletedProjectIds).toEqual(['p1']);
            expect(mockShowToast).toHaveBeenCalledTimes(1);
            expect(mockShowToast).toHaveBeenCalledWith(
                expect.stringContaining('删除失败'),
            );
            expect(mockRefreshScope).toHaveBeenCalledTimes(1);
            expect(mockRuntime.projects.list.mock.calls.length).toBeGreaterThan(
                listCallsBefore,
            );
        });
    });

    describe('handleDeleteProjects 缓存清理（b2/B-6）', () => {
        it('删除成功后按项目前缀清掉会话级缓存，未删项目不受影响', async () => {
            const p1ViewKey = SessionViewCache.key('p1', 's1');
            const p1TranscriptKey = transcriptScrollCacheKey('p1', 's1');
            const otherTranscriptKey = transcriptScrollCacheKey('p2', 's9');
            SessionViewCache.set(p1ViewKey, {messages: [], hasMoreMessages: false});
            ChatTranscriptScrollCache.set(p1TranscriptKey, {
                schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
                offsetY: 10,
                nearBottom: false,
            });
            ChatTranscriptScrollCache.set(otherTranscriptKey, {
                schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
                offsetY: 1,
                nearBottom: false,
            });
            const api = mountScope();

            await act(async () => {
                await api.handleDeleteProjects(['p1']);
            });

            expect(SessionViewCache.get(p1ViewKey)).toBeUndefined();
            expect(ChatTranscriptScrollCache.get(p1TranscriptKey)).toBeUndefined();
            expect(ChatTranscriptScrollCache.get(otherTranscriptKey)).toEqual({
                schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
                offsetY: 1,
                nearBottom: false,
            });
        });

        it('中途 reject：已删项目缓存已清、未删项目缓存保留', async () => {
            mockRuntime.projects.delete.mockImplementation(async (id: string) => {
                if (id === 'p2') {
                    return {ok: false as const, error: new Error('fs busy')};
                }
                deletedProjectIds.push(id);
                return {ok: true, value: undefined};
            });
            const p1Key = SessionViewCache.key('p1', 's1');
            const p2Key = SessionViewCache.key('p2', 's2');
            SessionViewCache.set(p1Key, {messages: [], hasMoreMessages: false});
            SessionViewCache.set(p2Key, {messages: [], hasMoreMessages: false});
            const api = mountScope();

            await act(async () => {
                await api.handleDeleteProjects(['p1', 'p2']);
            });

            expect(SessionViewCache.get(p1Key)).toBeUndefined();
            expect(SessionViewCache.get(p2Key)).toBeDefined();
        });
    });
});
