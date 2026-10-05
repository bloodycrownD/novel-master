/**
 * T-MP3：屏级受控展开——`RealPromptScreen` 把轮/组的展开态存在屏级 Set 里，
 * toggle 回调改的是屏级 state，而不是组件内 state。
 *
 * 为什么钉死屏级：轮卡展开区在 FlatList 里，`removeClippedSubviews` 会把滚出
 * 窗口的 item 卸载掉，组件内 state 随之丢失，用户滚回来展开态被重置。
 *
 * FlatList 桩这里**真渲染** row（与 scope 用例的空桩不同），这样才能观测到
 * 「onToggle → 屏级 Set → PromptTurnCard expanded」这条真实链路。
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {View} from 'react-native';
import type {PromptPreviewTurn} from '@novel-master/core/prompt';
import {RealPromptScreen} from '@/screens/stack/RealPromptScreen';
import {PromptTurnCard} from '@/components/prompt/PromptTurnCard';
import {takePromptTurnDetail} from '@/components/prompt/prompt-turn-callback';

const mockNavigate = jest.fn();
const mockBuildTurns = jest.fn(async () => [] as unknown[]);
/** 稳定引用的 runtime 桩（见下方 useRuntime 注释）。 */
const mockRuntime = {};
/**
 * 最近一次注册的 useFocusEffect 回调（focus 桩自己登记，供用例手动模拟
 * 「聚焦回流」）。只留最新一个：模拟回流只需最新那个。
 */
const mockFocus = {
  handler: undefined as (() => void | (() => void)) | undefined,
};

jest.mock('@/hooks/useMobileScope', () => ({
  useMobileScope: () => ({projectId: 'p1', sessionId: 's1'}),
}));

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    useRoute: () => ({params: undefined as unknown}),
    useNavigation: () => ({navigate: mockNavigate}),
    // 屏内重载已收敛为 useFocusEffect 单通道：按 useEffect 语义近似（挂载跑一次、
    // 回调变化重跑），照 TokenUsageStatsScreen 套件的先例；同时登记回调让用例
    // 能再触发一次，模拟「从别的屏聚焦回流」（refocus 后展开态是否保留的观测点）。
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockFocus.handler = cb;
      mockReact.useEffect(cb, [cb]);
    },
  };
});

// ⚠️ 必须返回**稳定引用**：runtime 一变，屏内 load 的 useCallback 依赖就变，
// useEffect 跟着重跑 → setState → 重渲染 → 又是新 runtime，死循环直到 OOM。
jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@/services/prompt-preview.service', () => ({
  buildRealPromptPreviewTurns: (...args: unknown[]) =>
    mockBuildTurns(...(args as [])),
}));

jest.mock('@/services/agent-run.service', () => ({
  AgentRunError: class AgentRunError extends Error {},
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#fff',
      surfaceElevated: '#fff',
      bgSecondary: '#f4f4f5',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#ddd',
      primary: '#06c',
      danger: '#c00',
    },
  }),
}));

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    ActivityIndicator: () => mockReact.createElement('ActivityIndicator'),
    // 真渲染 row：受控链路必须落到真实组件上才有意义。
    FlatList: ({
      data,
      keyExtractor,
      renderItem,
    }: {
      data: readonly {id: string}[];
      keyExtractor: (item: {id: string}) => string;
      renderItem: (info: {item: unknown; index: number}) => React.ReactNode;
    }) =>
      mockReact.createElement(
        'FlatList',
        {},
        data.map((item, index) =>
          mockReact.createElement(
            mockReact.Fragment,
            {key: keyExtractor(item)},
            renderItem({item, index}),
          ),
        ),
      ),
    Pressable: ({
      children,
      onPress,
      ...rest
    }: {
      children?: React.ReactNode;
      onPress?: (event?: {stopPropagation?: () => void}) => void;
    }) => mockReact.createElement('Pressable', {...rest, onPress}, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children, ...rest}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', rest, children),
    View: ({children, ...rest}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', rest, children),
  };
});

const TURN: PromptPreviewTurn = {
  id: 'turn-12',
  kind: 'assistant',
  items: [],
  summary: '好的，我来看看。 · 工具调用 1 次 · 12 字',
  // main/A-2 后 UI 不再读 body，字段仅为满足 core 类型（`body` 是必填）。
  body: '',
  summaryText: '好的，我来看看。',
  metaText: '#12 · 工具调用 1 次 · 12 字',
  // type 分派顺序锚：text / toolGroup / thinking 三卡依次渲染。
  cards: [
    {type: 'text', id: 'card-12-0', role: 'assistant', body: '好的，我来看看。'},
    {
      type: 'toolGroup',
      id: 'group-tu-1',
      toolName: 'read',
      inputJson: '{}',
      result: {toolUseId: 'tu-1', ok: true, body: '文件内容'},
      status: 'ok',
      parallel: false,
    },
    {type: 'thinking', id: 'card-12-1', role: 'assistant', body: '先找一下文件'},
  ],
};

/** 第二条轮：给 T-MP3-3「同一 act 内连按两个轮头」当受测对象。 */
const TURN_B: PromptPreviewTurn = {
  ...TURN,
  id: 'turn-13',
  summaryText: '找到了，接着改。',
  metaText: '#13 · 工具调用 0 次 · 7 字',
  cards: [{type: 'text', id: 'card-13-0', role: 'assistant', body: '找到了，接着改。'}],
};

async function renderScreen(
  turns: PromptPreviewTurn[] = [TURN],
): Promise<TestRenderer.ReactTestRenderer> {
  mockBuildTurns.mockResolvedValue(turns);
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<RealPromptScreen />);
  });
  await Promise.resolve();
  await Promise.resolve();
  act(() => {
    tree.update(<RealPromptScreen />);
  });
  return tree;
}

/** 手动模拟一次「聚焦回流」：重跑屏内登记的 focus 回调（即 load），并冲干净微任务。 */
async function refocus(): Promise<void> {
  act(() => {
    mockFocus.handler?.();
  });
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/**
 * 只取宿主节点。
 *
 * RN 桩里复合组件（`View: ({...rest}) => createElement('View', rest)`）与它渲染出的
 * 宿主元素带**同一份 props**，所以 `findAllByProps` 会把同一个 UI 元素数两次
 * （'function' + 'string' 各一）。按 testID 计数/取第 N 个时必须先滤到宿主层，
 * 否则一轮的头会被当成两个。
 */
function hostNodes(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
): TestRenderer.ReactTestInstance[] {
  return tree.root.findAll(
    node =>
      typeof node.type === 'string' &&
      (node.props as {testID?: string}).testID === testID,
  );
}

function press(
  tree: TestRenderer.ReactTestRenderer,
  testID: string,
  index = 0,
): void {
  act(() => {
    // 多命中时 findByProps 只返回第一个、不报错，所以按 testID 取第 index 个宿主节点。
    (hostNodes(tree, testID)[index].props as {onPress: (e?: unknown) => void}).onPress();
  });
}

/** 按文档序收集渲染树里的 testID（复合节点与宿主节点都会带同一 testID，故取宿主层）。 */
function testIDsInOrder(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      testIDsInOrder(child, out);
    }
    return out;
  }
  if (node != null && typeof node === 'object') {
    const obj = node as {props?: {testID?: string}; children?: unknown};
    if (typeof obj.props?.testID === 'string') {
      out.push(obj.props.testID);
    }
    if (obj.children != null) {
      testIDsInOrder(obj.children, out);
    }
  }
  return out;
}

function pressHead(tree: TestRenderer.ReactTestRenderer, index: number): void {
  (hostNodes(tree, 'prompt-turn-head')[index].props as {
    onPress: () => void;
  }).onPress();
}

describe('RealPromptScreen 屏级受控展开（T-MP3）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocus.handler = undefined;
    mockBuildTurns.mockResolvedValue([TURN]);
    // 模块级单例复位：残留正文会让下一条用例读到上一轮的数据。
    takePromptTurnDetail();
  });

  it('T-MP3-1 toggle 改屏级 openTurnIds：展开区随之挂载/卸载', async () => {
    const tree = await renderScreen();
    expect(() => tree.root.findByProps({testID: 'prompt-turn-body'})).toThrow();

    press(tree, 'prompt-turn-head');
    expect(tree.root.findByProps({testID: 'prompt-turn-body'})).toBeTruthy();
    // 展开区里能看到该轮的卡片流（工具组卡）。
    expect(tree.root.findByProps({testID: 'prompt-tool-group-card'})).toBeTruthy();

    press(tree, 'prompt-turn-head');
    expect(() => tree.root.findByProps({testID: 'prompt-turn-body'})).toThrow();
  });

  it('T-MP3-2 组卡展开同样受控（openGroupIds 与轮展开独立）', async () => {
    const tree = await renderScreen();
    press(tree, 'prompt-turn-head');
    // 轮展开、组收起。
    expect(() => tree.root.findByProps({testID: 'prompt-tool-group-body'})).toThrow();

    press(tree, 'prompt-tool-group-head');
    expect(tree.root.findByProps({testID: 'prompt-tool-group-body'})).toBeTruthy();
    // 收起组不影响轮展开态。
    expect(tree.root.findByProps({testID: 'prompt-turn-body'})).toBeTruthy();
  });

  it('T-MP3-3 同一 act 内连按两个轮头：两条轮都展开（函数式更新，非闭包值）', async () => {
    const tree = await renderScreen([TURN, TURN_B]);
    act(() => {
      // 同一个 act 里连按两个不同轮头：若 toggle 写的是闭包捕获的旧 Set，
      // 第二次按会把第一次的展开态覆盖掉，只剩一条轮。
      pressHead(tree, 0);
      pressHead(tree, 1);
    });
    expect(hostNodes(tree, 'prompt-turn-body')).toHaveLength(2);
    expect(hostNodes(tree, 'prompt-turn-role')).toHaveLength(2);
  });

  it('T-MP3-4 卡片流按 cards 顺序分派、turnId 透传到叶子卡', async () => {
    const tree = await renderScreen();
    press(tree, 'prompt-turn-head');
    // 夹具是 [text, group, thinking]：渲染顺序必须跟着 cards 走，不按 type 归堆。
    const cardOrder = testIDsInOrder(tree.toJSON()).filter(id =>
      ['prompt-turn-leaf-card', 'prompt-tool-group-card'].includes(id),
    );
    expect(cardOrder).toEqual([
      'prompt-turn-leaf-card',
      'prompt-tool-group-card',
      'prompt-turn-leaf-card',
    ]);
    // turnId 透传：叶子卡全屏的路由参数带轮 id（不是叶子 id 串进路由）。
    press(tree, 'prompt-turn-leaf-card', 0);
    expect(mockNavigate).toHaveBeenCalledWith('PromptTurnDetail', {
      title: 'assistant',
      turnId: TURN.id,
    });
    expect(takePromptTurnDetail()).toEqual({
      title: 'assistant',
      body: '好的，我来看看。',
      leafId: 'card-12-0',
    });
  });

  it('T-PR1 聚焦回流后展开态保留（同会话 refocus 不清展开态）', async () => {
    const tree = await renderScreen();
    press(tree, 'prompt-turn-head');
    expect(tree.root.findByProps({testID: 'prompt-turn-body'})).toBeTruthy();

    await refocus();
    // 前置：refocus 真的重取了一轮数，否则本用例会白绿。
    expect(mockBuildTurns).toHaveBeenCalledTimes(2);
    // 点子卡看全屏详情再返回是本屏最高频的出栈路径，用户刚展开的轮不能被收走
    // （清展开态改按 sessionId 判，同会话 refocus 保留）。
    expect(tree.root.findByProps({testID: 'prompt-turn-body'})).toBeTruthy();
  });
});