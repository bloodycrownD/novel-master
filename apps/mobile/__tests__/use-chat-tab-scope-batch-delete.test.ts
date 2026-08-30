/**
 * fix-b2-b4：批量删除中途失败的部分成功语义。
 * - deleteSelectedSessions：全部成功 / 第二个 session delete reject。
 * - handleDeleteProjects：中途 reject 后 finally 刷新仍执行。
 * 只 mock runtime 与 meta/token 服务；被测 hook、toast-message、
 * session view cache 均用真实实现。
 */
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabScope} from '../src/screens/tabs/chat-tab/useChatTabScope';
import {
  clearAllSessionViewCaches,
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from '../src/services/chat-session-view-cache';
import {
  clearAllScrollSnapshots,
  getScrollSnapshot,
  scrollCacheKey,
  setScrollSnapshot,
} from '../src/services/chat-list-scroll-cache';
import {
  clearAllTranscriptScrollSnapshots,
  getTranscriptScrollSnapshot,
  scrollCacheKey as transcriptScrollCacheKey,
  setTranscriptScrollSnapshot,
} from '../src/services/chat-transcript-scroll-cache';
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '../src/components/chat/ChatTranscriptBridge';

jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: jest.fn(async () => ({
    source: 'session',
    agentId: 'a1',
    agentName: 'Agent',
    modelLabel: 'Model',
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
  })),
}));

jest.mock('../src/services/chat-prompt-tokens.service', () => ({
  loadChatPromptTokenLabelResilient: jest.fn(async () => ''),
}));

const deletedSessionIds: string[] = [];
const deletedProjectIds: string[] = [];

const mockRuntime: any = {
  projects: {
    list: jest.fn(async () => [{id: 'p1', name: 'P1'}]),
    get: jest.fn(async () => ({id: 'p1', name: 'P1'})),
    delete: jest.fn(async (id: string) => {
      deletedProjectIds.push(id);
    }),
  },
  sessions: {
    listByProject: jest.fn(async () => [
      {id: 's1', title: 'S1', updatedAtMs: 1},
      {id: 's2', title: 'S2', updatedAtMs: 2},
      {id: 's3', title: 'S3', updatedAtMs: 3},
    ]),
    delete: jest.fn(async (id: string) => {
      deletedSessionIds.push(id);
    }),
  },
  state: {
    getCurrentModelId: jest.fn(async () => 'openai/gpt-4o-mini'),
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
    clearAllSessionViewCaches();
    clearAllScrollSnapshots();
    clearAllTranscriptScrollSnapshots();
    mockRuntime.sessions.delete.mockImplementation(async (id: string) => {
      deletedSessionIds.push(id);
    });
    mockRuntime.projects.delete.mockImplementation(async (id: string) => {
      deletedProjectIds.push(id);
    });
  });

  describe('deleteSelectedSessions', () => {
    it('全部成功：逐个 delete、退出批选、刷新执行', async () => {
      const s1Key = sessionViewCacheKey('p1', 's1');
      setSessionViewCache(s1Key, {messages: [], hasMoreMessages: false});
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
      expect(getSessionViewCache(s1Key)).toBeUndefined();
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('第二个 delete reject：toast 提示、批选仍退出、第一个已删不复活', async () => {
      mockRuntime.sessions.delete.mockImplementation(async (id: string) => {
        if (id === 's2') {
          throw new Error('db locked');
        }
        deletedSessionIds.push(id);
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
      // 真实 toastMessage('删除失败', error) 产出「删除失败：db locked」。
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
          throw new Error('fs busy');
        }
        deletedProjectIds.push(id);
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
      const p1ViewKey = sessionViewCacheKey('p1', 's1');
      const p1ScrollKey = scrollCacheKey('p1', 's1');
      const p1TranscriptKey = transcriptScrollCacheKey('p1', 's1');
      const otherScrollKey = scrollCacheKey('p2', 's9');
      setSessionViewCache(p1ViewKey, {messages: [], hasMoreMessages: false});
      setScrollSnapshot(p1ScrollKey, {offsetY: 10, nearBottom: false});
      setTranscriptScrollSnapshot(p1TranscriptKey, {
        schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
        offsetY: 10,
        nearBottom: false,
      });
      setScrollSnapshot(otherScrollKey, {offsetY: 1, nearBottom: false});
      const api = mountScope();

      await act(async () => {
        await api.handleDeleteProjects(['p1']);
      });

      expect(getSessionViewCache(p1ViewKey)).toBeUndefined();
      expect(getScrollSnapshot(p1ScrollKey)).toBeUndefined();
      expect(getTranscriptScrollSnapshot(p1TranscriptKey)).toBeUndefined();
      expect(getScrollSnapshot(otherScrollKey)).toEqual({
        offsetY: 1,
        nearBottom: false,
      });
    });

    it('中途 reject：已删项目缓存已清、未删项目缓存保留', async () => {
      mockRuntime.projects.delete.mockImplementation(async (id: string) => {
        if (id === 'p2') {
          throw new Error('fs busy');
        }
        deletedProjectIds.push(id);
      });
      const p1Key = sessionViewCacheKey('p1', 's1');
      const p2Key = sessionViewCacheKey('p2', 's2');
      setSessionViewCache(p1Key, {messages: [], hasMoreMessages: false});
      setSessionViewCache(p2Key, {messages: [], hasMoreMessages: false});
      const api = mountScope();

      await act(async () => {
        await api.handleDeleteProjects(['p1', 'p2']);
      });

      expect(getSessionViewCache(p1Key)).toBeUndefined();
      expect(getSessionViewCache(p2Key)).toBeDefined();
    });
  });
});
