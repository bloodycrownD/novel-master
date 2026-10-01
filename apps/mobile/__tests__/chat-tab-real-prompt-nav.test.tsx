/**
 * T-AM3-4：useChatTabController 的 RealPrompt 入口必须带 scope（AM-3）。
 *
 * 病灶：第二处 `navigate('RealPrompt')` 同样零参数 ⇒ 屏内回落读全局 scope，
 * 后台通知栈外改过 scope 时会展示别的会话的提示词。
 *
 * 夹具说明：按 spec 不得挂载 ChatTabProvider（会牵进整个 chat-tab 依赖树），
 * 改为 jest.mock 掉 useChatTabContext、按该 hook 真正读到的字段造最小 ctx。
 * 缺字段会在解构处直接抛错——那属夹具漏字段，不是实现问题。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useChatTabController} from '@/screens/tabs/chat-tab/useChatTabController';

const mockNavigate = jest.fn();

function makeCtx(overrides: Record<string, unknown> = {}): unknown {
  return {
    navigation: {navigate: mockNavigate},
    projectId: 'p1',
    sessionId: 's1',
    chatMessages: [],
    unitView: null,
    runtime: {sessionStreamUnitManager: {}},
    messages: {setDraftRestoreToken: jest.fn()},
    scope: {refreshChatTokenLabel: jest.fn(), reloadLists: jest.fn()},
    showToast: jest.fn(),
    bumpWorktreeUiToken: jest.fn(),
    setCurrentSession: jest.fn(),
    setChatSubview: jest.fn(),
    setConversationPanel: jest.fn(),
    setMessageEditPrompt: jest.fn(),
    setMessageMenuTarget: jest.fn(),
    setMessageMenuAnchor: jest.fn(),
    setWebMenuOpen: jest.fn(),
    closeMessageMenu: jest.fn(),
    messageMenuTarget: null,
    ...overrides,
  };
}

// 名字必须以 mock 开头：jest.mock 工厂被提升到 import 之前，
// 只允许引用 mock 前缀的变量（防未初始化捕获）。
const mockCtxHolder: {current: unknown} = {current: makeCtx()};

jest.mock('@/screens/tabs/chat-tab/ChatTabProvider', () => ({
  useChatTabContext: () => mockCtxHolder.current,
}));

// 消息动作那支与本断言无关，桩掉避免把 message-edit / workplace 依赖树拖进来。
jest.mock('@/screens/tabs/chat-tab/useChatTabMessageActions', () => ({
  useChatTabMessageActions: () => ({
    handleMessageMenuAction: jest.fn(),
  }),
}));

jest.mock('@/services/workplace-block.service', () => ({
  clearSessionWorkplaceKkv: jest.fn(),
}));

describe('T-AM3-4 useChatTabController RealPrompt 入口', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCtxHolder.current = makeCtx();
  });

  it('onNavigateRealPrompt 传 projectId / sessionId', () => {
    let api: ReturnType<typeof useChatTabController> | undefined;
    function Harness() {
      api = useChatTabController();
      return null;
    }
    act(() => {
      TestRenderer.create(<Harness />);
    });
    act(() => {
      api!.onNavigateRealPrompt();
    });
    expect(mockNavigate).toHaveBeenCalledWith('RealPrompt', {
      projectId: 'p1',
      sessionId: 's1',
    });
  });

  it('scope 两值皆空时退化为无参（屏内回落，不引入新分支）', () => {
    mockCtxHolder.current = makeCtx({projectId: null, sessionId: null});
    let api: ReturnType<typeof useChatTabController> | undefined;
    function Harness() {
      api = useChatTabController();
      return null;
    }
    act(() => {
      TestRenderer.create(<Harness />);
    });
    act(() => {
      api!.onNavigateRealPrompt();
    });
    expect(mockNavigate).toHaveBeenCalledWith('RealPrompt', {
      projectId: undefined,
      sessionId: undefined,
    });
  });
});
