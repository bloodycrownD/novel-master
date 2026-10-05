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
 * 另附 T-PR1/T-PR2：focus 重载单通道与 load 竞态守卫（手动压缩后 workplace
 * 重评估，靠聚焦回流取新数据）。
 *
 * 观测面是 `buildRealPromptPreviewTurns` 收到的实参（注入缝，与实现同源）。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {RealPromptScreen} from '@/screens/stack/RealPromptScreen';

const mockBuildSegments = jest.fn(async () => [] as unknown[]);
/**
 * 最近一次注册的 useFocusEffect 回调（focus 桩自己登记，供 T-PR1 手动模拟
 * 「聚焦回流」）。只留最新一个：render 期间可能重复登记，模拟回流只需最新。
 */
const mockFocus = {
  handler: undefined as (() => void | (() => void)) | undefined,
};
/** 本文件造出的渲染根（用例结束后统一卸载，见下方 afterEach 注释）。 */
const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

jest.mock('@/hooks/useMobileScope', () => ({
  useMobileScope: jest.fn(() => ({projectId: 'pB', sessionId: 'sB'})),
}));

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    useRoute: jest.fn(() => ({params: undefined as unknown})),
    // 近似真实 focus 行为：挂载（首焦）跑一次、回调标识变化时重跑（照
    // TokenUsageStatsScreen 套件的先例）；同时登记回调让用例能再触发一次，
    // 模拟「从别的屏聚焦回流」。屏内重载已是 useFocusEffect 单通道，
    // mock 须锁定该真实行为而非绕开它。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockFocus.handler = cb;
      mockReact.useEffect(cb, [cb]);
    },
  };
});

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
    // data 透传给宿主节点：T-PR2 的竞态守卫要读「屏上最后落地的是哪一轮」，
    // 空桩丢 props 就只能反推 service 调用次数，看不见 state。
    FlatList: ({data, ...rest}: {data?: unknown}) =>
      mockReact.createElement('FlatList', {testID: 'prompt-list', ...rest, data}),
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

/** 把若干轮微任务/宏任务冲干净（promise 链上的 setState 要落地才观测得到）。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/** 手控的 promise：用来把某一次取数的落定时机攥在用例手里。 */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

/** FlatList 宿主节点（列表被 spinner 顶掉时为空数组，是静默档的观测面）。 */
function promptListNodes(
  tree: TestRenderer.ReactTestRenderer,
): TestRenderer.ReactTestInstance[] {
  return tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      (node.props as {testID?: string}).testID === 'prompt-list',
  );
}

/** 屏上是否还有列表（false = 被全屏 spinner 顶掉了）。 */
function hasPromptList(tree: TestRenderer.ReactTestRenderer): boolean {
  return promptListNodes(tree).length > 0;
}

/** 取 FlatList 宿主节点上落地的那份 data（竞态守卫的观测面）。 */
function listData(
  tree: TestRenderer.ReactTestRenderer,
): readonly {id: string}[] {
  const nodes = promptListNodes(tree);
  return nodes.length === 0
    ? []
    : ((nodes[nodes.length - 1].props as {data?: readonly {id: string}[]})
        .data ?? []);
}

/** 屏上所有 Text 渲染出的文案（error 文案的观测面）。 */
function textLines(tree: TestRenderer.ReactTestRenderer): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node == null || typeof node !== 'object') {
      return;
    }
    const obj = node as {type?: unknown; children?: unknown};
    if (obj.type === 'Text') {
      out.push(flattenText(obj.children));
    }
    walk(obj.children);
  };
  walk(tree.toJSON());
  return out;
}

function flattenText(node: unknown): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  if (typeof node === 'object') {
    return flattenText((node as {children?: unknown}).children);
  }
  return String(node);
}

/** 手动模拟一次「聚焦回流」：重跑屏内登记的 focus 回调（即 load）。 */
async function refocus(): Promise<void> {
  act(() => {
    mockFocus.handler?.();
  });
  await flush();
}

async function renderScreen(): Promise<TestRenderer.ReactTestRenderer> {
  // ⚠️ 这里**不能**用 `await act(async () => ...)`：本仓的 react-test-renderer
  // 与 act 的 scheduler 组合下那个写法会挂死（5s 超时，而渲染其实已完成）。
  // 同步 act 挂载即触发 load()（实参在 focus 回调里同步取出），
  // 随后的冲刷只是让 setState 落地、结果可观测。
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<RealPromptScreen />);
  });
  mountedTrees.push(tree);
  await flush();
  return tree;
}

// ⚠️ 每条用例后必须卸载：TestRenderer 造出的根不会随用例结束消失，它留在
// 后面用例的 act/冲刷里继续 setState 与重渲染，会把「本用例调了几次
// buildRealPromptPreviewTurns」这类计数断言搅浑（实测会多出等量的陈年调用）。
afterEach(() => {
  while (mountedTrees.length > 0) {
    act(() => {
      mountedTrees.pop()?.unmount();
    });
  }
  mockFocus.handler = undefined;
});

describe('RealPromptScreen scope 取值（AM-3）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocus.handler = undefined;
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

describe('RealPromptScreen focus 重载（preview-refresh）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocus.handler = undefined;
    setRouteParams({projectId: 'pA', sessionId: 'sA'});
    mockBuildSegments.mockResolvedValue([]);
  });

  it('T-PR1 挂载只取一次、聚焦回流再取一次（useFocusEffect 单通道不双跑）', async () => {
    mockBuildSegments.mockResolvedValueOnce([
      {id: 'turn-old', kind: 'assistant', cards: []},
    ]);
    // 第二轮挂住不落定：只有取数在途时才看得见「静默档」——非静默档会在
    // refocus 瞬间把整列表换成全屏 spinner，等取数回来又换回来，事后断言
    // 什么都看不见（这条断言的全部价值就在这个在途窗口里）。
    const second = deferred<unknown[]>();
    mockBuildSegments.mockImplementationOnce(() => second.promise);
    const tree = await renderScreen();
    // 首焦恰好一轮：换成 useFocusEffect 之后若忘了删挂载 effect，这里会是 2。
    expect(mockBuildSegments).toHaveBeenCalledTimes(1);
    expect(listData(tree).map(t => t.id)).toEqual(['turn-old']);

    await refocus();
    // 从别的屏回来（手动压缩完 workplace 已重评估）要重新取数。
    expect(mockBuildSegments).toHaveBeenCalledTimes(2);
    // 静默档（cr-mobile/B-1）：refocus 在途时列表节点仍在，没被 spinner 顶掉——
    // 否则「每读一张子卡返回一次闪一次转圈」。
    expect(hasPromptList(tree)).toBe(true);

    second.resolve([{id: 'turn-new', kind: 'assistant', cards: []}]);
    await flush();
    expect(listData(tree).map(t => t.id)).toEqual(['turn-new']);
    expect(hasPromptList(tree)).toBe(true);
  });

  it('T-PR2 竞态守卫：先发后到的旧响应被丢弃，屏上留最后一次结果', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    mockBuildSegments.mockImplementationOnce(() => first.promise);
    mockBuildSegments.mockImplementationOnce(() => second.promise);
    const tree = await renderScreen();
    await refocus();
    expect(mockBuildSegments).toHaveBeenCalledTimes(2);

    // 新一轮先落定 → 屏上先显示新数据。
    second.resolve([{id: 'turn-new', kind: 'assistant', cards: []}]);
    await flush();
    expect(listData(tree).map(t => t.id)).toEqual(['turn-new']);

    // 旧请求此刻才回来（无中止点，取数耗时不定）——不能覆盖新一轮结果。
    first.resolve([{id: 'turn-stale', kind: 'assistant', cards: []}]);
    await flush();
    expect(listData(tree).map(t => t.id)).toEqual(['turn-new']);
  });

  it('T-PR2b 过期请求的失败不覆盖新一轮成功结果', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    mockBuildSegments.mockImplementationOnce(() => first.promise);
    mockBuildSegments.mockImplementationOnce(() => second.promise);
    const tree = await renderScreen();
    await refocus();
    expect(mockBuildSegments).toHaveBeenCalledTimes(2);

    second.resolve([{id: 'turn-new', kind: 'assistant', cards: []}]);
    await flush();
    expect(listData(tree).map(t => t.id)).toEqual(['turn-new']);

    // 旧请求此刻才失败（真机最易撞的时序：VFS 读一半被新压缩打断）——报错
    // 文案不能跳出来盖掉新一轮的成功结果，否则用户以为当前会话出错。
    first.reject(new Error('stale boom'));
    await flush();
    expect(listData(tree).map(t => t.id)).toEqual(['turn-new']);
    expect(textLines(tree)).not.toContain('stale boom');
  });
});
