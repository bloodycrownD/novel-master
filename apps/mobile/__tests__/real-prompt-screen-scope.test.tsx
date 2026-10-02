/**
 * T-AM3-1/2：RealPromptScreen 的 scope 取值——路由参数优先、缺省回落全局 scope。
 *
 * 病灶（AM-3）：路由类型是 `RealPrompt: undefined`，两处入口都不传参，
 * 屏内只读 `useMobileScope()`。后台通知的 tap handler 会**栈外**改 scope
 * （`setCurrentSession` + `setScope`），而 `navigate('MainTabs')` 不带 pop、
 * `MainTabs` 又没有 getId ⇒ 栈顶仍是**别的**会话详情页。
 * 这时点「查看提示词」就会显示另一个会话的提示词，屏上不出现会话名、
 * 用户无从察觉（错数据 + 零逃生路线）。
 *
 * 观测面是 `buildRealPromptPreviewTurns` 收到的实参（注入缝，与实现同源）。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {RealPromptScreen} from '@/screens/stack/RealPromptScreen';

const mockBuildSegments = jest.fn(async () => [] as unknown[]);

jest.mock('@/hooks/useMobileScope', () => ({
  useMobileScope: jest.fn(() => ({projectId: 'pB', sessionId: 'sB'})),
}));

jest.mock('@react-navigation/native', () => ({
  useRoute: jest.fn(() => ({params: undefined as unknown})),
}));

// ⚠️ 必须返回**稳定引用**：屏内 load 的 useCallback 依赖 runtime，runtime 一变
// effect 就重跑 → setTurns 触发重渲染 → 又是新 runtime，测试结束前一直循环
// （表现为 "Cannot log after tests are done" 噪声刷屏）。
const mockRuntime = {};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@/services/prompt-preview.service', () => ({
  buildRealPromptPreviewTurns: (...args: unknown[]) =>
    mockBuildSegments(...(args as [])),
}));

// AgentRunError 只在 catch 分支做 instanceof；桩掉整条 service 依赖链，
// 避免把 agent-run 的重依赖树拖进这个纯取值用例。
jest.mock('@/services/agent-run.service', () => ({
  AgentRunError: class AgentRunError extends Error {},
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      text: '#111',
      textSecondary: '#666',
      danger: '#c00',
    },
  }),
}));

// 轮卡自带 useNavigation（顶层禁用的红线只约束屏组件），这里整族桩掉：
// FlatList 桩不渲染 row，本来也渲染不到，桩掉只为免掉重依赖树。
jest.mock('@/components/prompt/PromptTurnCard', () => {
  const mockReact = require('react');
  return {
    PromptTurnCard: () => mockReact.createElement('View', {}),
    useOpenPromptDetail: () => () => undefined,
  };
});

jest.mock('@/components/prompt/PromptToolGroupCard', () => {
  const mockReact = require('react');
  return {
    PromptToolGroupCard: () => mockReact.createElement('View', {}),
  };
});

jest.mock('@/components/prompt/PromptTurnLeafCard', () => {
  const mockReact = require('react');
  return {
    PromptTurnLeafCard: () => mockReact.createElement('View', {}),
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    ActivityIndicator: () => mockReact.createElement('ActivityIndicator'),
    FlatList: () => mockReact.createElement('FlatList', {}),
    StyleSheet: {create: (s: object) => s},
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', {}, children),
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', {}, children),
  };
});

function setRouteParams(params: unknown): void {
  const nav = jest.requireMock('@react-navigation/native') as {
    useRoute: jest.Mock;
  };
  nav.useRoute.mockReturnValue({params});
}

async function renderScreen(): Promise<void> {
  // ⚠️ 这里**不能**用 `await act(async () => ...)`：本仓的 react-test-renderer
  // 与 act 的 scheduler 组合下那个写法会挂死（5s 超时，而渲染其实已完成）。
  // 同步 act 挂载即触发 load()（实参在 effect 里同步取出），
  // 随后的微任务冲刷只是让 setState 落地，观测面（mock 的调用实参）不依赖它。
  act(() => {
    TestRenderer.create(<RealPromptScreen />);
  });
  await Promise.resolve();
  await Promise.resolve();
}

describe('RealPromptScreen scope 取值（AM-3）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSegments.mockResolvedValue([]);
    setRouteParams(undefined);
  });

  it('T-AM3-1 路由参数优先于全局 scope', async () => {
    setRouteParams({projectId: 'pA', sessionId: 'sA'});
    await renderScreen();
    expect(mockBuildSegments).toHaveBeenCalledWith(
      expect.anything(),
      {projectId: 'pA', sessionId: 'sA'},
    );
  });

  it('T-AM3-2 无参进栈时回落全局 scope（防过修）', async () => {
    setRouteParams(undefined);
    await renderScreen();
    expect(mockBuildSegments).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'pB',
      sessionId: 'sB',
    });
  });

  it('T-AM3-2 路由只给一半时逐字段回落', async () => {
    setRouteParams({projectId: 'pA'});
    await renderScreen();
    expect(mockBuildSegments).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'pA',
      sessionId: 'sB',
    });
  });
});
