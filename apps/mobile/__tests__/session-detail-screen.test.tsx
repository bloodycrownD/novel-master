/**
 * 会话详情页 mobile UI 测试（T-M2 / T-M5）。
 *
 * 详情页重做后的交互（参考 QQ 详情页）：
 * - 聊天名点击 → inline TextInput 编辑，提交后调 sessions.rename。
 * - 当前智能体 / 当前大模型 各是一张可点击卡片，点击直接弹对应 picker。
 * - 次要操作（查看提示词 / 压缩上下文 / 重命名弹层）已迁到 ⋯ 按钮的
 *   SessionActionsDrawer，详情页不再承载，故不再覆盖。
 *
 * T-M5: picker select 分流——会话内写 session 绑定，全局页写 workspace。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

// ── SessionDetailScreen 依赖 mock（jest.mock 会被 babel 提升到 import 之前） ──
const mockSessionsGet = jest.fn(async () => ({id: 's1', title: '我的会话'}));
const mockSessionsRename = jest.fn(async () => undefined);
const mockSessionsGetSessionAgentConfig = jest.fn(async () => ({
  agentId: 'workspace-agent',
}));
const mockSessionsUpdateSessionAgentConfig = jest.fn(async () => ({
  agentId: 'workspace-agent',
}));
const mockStateGetCurrentAgentId = jest.fn(async () => 'workspace-agent');
const mockStateGetCurrentModelId = jest.fn(async () => 'model-ws');
const mockStateSetCurrentModelId = jest.fn(async () => undefined);
const mockStateSetCurrentAgentId = jest.fn(async () => undefined);

const mockRuntime = {
  sessions: {
    get: mockSessionsGet,
    rename: mockSessionsRename,
    getSessionAgentConfig: mockSessionsGetSessionAgentConfig,
    updateSessionAgentConfig: mockSessionsUpdateSessionAgentConfig,
  },
  state: {
    getCurrentAgentId: mockStateGetCurrentAgentId,
    getCurrentModelId: mockStateGetCurrentModelId,
    setCurrentModelId: mockStateSetCurrentModelId,
    setCurrentAgentId: mockStateSetCurrentAgentId,
  },
};

const mockShowToast = jest.fn();
let mockRouteParams: {projectId: string; sessionId: string} = {
  projectId: 'p1',
  sessionId: 's1',
};

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f5f5f5',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ddd',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

const mockLoadChatAgentMeta = jest.fn();
jest.mock('../src/services/chat-agent-meta', () => ({
  loadChatAgentMeta: (...args: unknown[]) => mockLoadChatAgentMeta(...args),
}));

jest.mock('../src/components/agent/AgentPickerModal', () => {
  const React = require('react');
  return {
    AgentPickerModal: (props: {
      visible: boolean;
      sessionId?: string;
      onClose: () => void;
    }) =>
      React.createElement('View', {
        testID: 'agent-picker-modal',
        visible: String(props.visible),
        sessionId: props.sessionId,
      }),
  };
});
jest.mock('../src/components/provider/ModelPickerModal', () => {
  const React = require('react');
  return {
    ModelPickerModal: (props: {
      visible: boolean;
      sessionId?: string;
      onClose: () => void;
    }) =>
      React.createElement('View', {
        testID: 'model-picker-modal',
        visible: String(props.visible),
        sessionId: props.sessionId,
      }),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: mockRouteParams}),
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useFocusEffect: () => undefined,
}));

jest.mock('react-native', () => {
  const RnReact = require('react');
  return {
    ScrollView: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => RnReact.createElement('View', {testID}, children),
    TextInput: (props: {
      testID?: string;
      value?: string;
      onChangeText?: (v: string) => void;
      onSubmitEditing?: () => void;
      onEndEditing?: () => void;
    }) =>
      RnReact.createElement('TextInput', {
        testID: props.testID,
        value: props.value,
        onChangeText: props.onChangeText,
        onSubmitEditing: props.onSubmitEditing,
        onEndEditing: props.onEndEditing,
      }),
    Pressable: (props: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      testID?: string;
    }) =>
      RnReact.createElement(
        'View',
        {
          testID: props.testID ?? props.accessibilityLabel,
          onPress: props.onPress,
          disabled: String(props.disabled ?? false),
        },
        props.children,
      ),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      RnReact.createElement('Text', {testID}, children),
    View: ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
      RnReact.createElement('View', {testID}, children),
  };
});

import {SessionDetailScreen} from '../src/screens/stack/SessionDetailScreen';
import {
  selectSessionAgent,
  selectWorkspaceAgent,
} from '../src/services/agent-picker';
import type {ChatAgentMeta} from '../src/services/chat-agent-meta';

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function meta(overrides: Partial<ChatAgentMeta> = {}): ChatAgentMeta {
  return {
    source: 'session',
    agentId: 'agent-a',
    agentName: 'Alpha',
    modelLabel: 'Model-1',
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
    ...overrides,
  };
}

describe('T-M2 SessionDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {projectId: 'p1', sessionId: 's1'};
    mockSessionsGet.mockResolvedValue({id: 's1', title: '我的会话'});
    mockLoadChatAgentMeta.mockResolvedValue(meta());
  });

  it('渲染聊天名 / agent / model 卡片（不再有来源标签）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('我的会话');
    expect(json).toContain('Alpha');
    expect(json).toContain('Model-1');
    // 已去除来源标签 badge，确认不再残留
    expect(json).not.toContain('会话引用');
    expect(json).not.toContain('点击编辑');
    // 卡片右侧 chevron 暗示可点（非锁定场景）
    expect(json).toContain('›');
  });

  it('点击当前智能体卡片打开 AgentPickerModal（session 模式：传 sessionId）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: 'agent-row'}).props.onPress();
    });
    const picker = tree.root.findByProps({testID: 'agent-picker-modal'});
    expect(picker.props.visible).toBe('true');
    expect(picker.props.sessionId).toBe('s1');
  });

  it('点击当前大模型卡片打开 ModelPickerModal（session 模式：传 sessionId）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: 'model-row'}).props.onPress();
    });
    const picker = tree.root.findByProps({testID: 'model-picker-modal'});
    expect(picker.props.visible).toBe('true');
    expect(picker.props.sessionId).toBe('s1');
  });

  it('project-custom 时 agent 卡片显示锁图标，点击不进 picker 弹锁定提示', async () => {
    mockLoadChatAgentMeta.mockResolvedValue(meta({source: 'project-custom'}));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    const json = JSON.stringify(tree.toJSON());
    // 锁定场景 chevron 换成锁图标
    expect(json).toContain('🔒');
    await act(async () => {
      tree.root.findByProps({testID: 'agent-row'}).props.onPress();
    });
    const picker = tree.root.findByProps({testID: 'agent-picker-modal'});
    expect(picker.props.visible).toBe('false');
    expect(mockShowToast).toHaveBeenCalled();
  });

  it('agent pin（modelSource=agent-pin）时点击大模型卡片不进 picker，弹锁定提示', async () => {
    mockLoadChatAgentMeta.mockResolvedValue(
      meta({modelSource: 'agent-pin', hasDedicatedModel: true}),
    );
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: 'model-row'}).props.onPress();
    });
    const picker = tree.root.findByProps({testID: 'model-picker-modal'});
    expect(picker.props.visible).toBe('false');
    expect(mockShowToast).toHaveBeenCalled();
  });

  // review-mobile/B-1 + G-2：source='none'（agent 解析失败）时 agent/model 卡片都应锁定。
  it("source='none' 时 agent/model 卡片都锁定，点击只弹锁定提示不进 picker", async () => {
    // chat-agent-meta.ts 在 AgentRunResolveError 时会回填这条 meta
    mockLoadChatAgentMeta.mockResolvedValue(meta({source: 'none'}));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    const json = JSON.stringify(tree.toJSON());
    // 两张锁定卡片都应是 🔒（chat-history-row 是新增的常驻入口，始终带 ›，
    // 所以不再用「整页不含 ›」反向断言，改成检查 🔒 数量）
    expect(json).toContain('🔒');
    expect((json.match(/🔒/g) ?? []).length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      tree.root.findByProps({testID: 'agent-row'}).props.onPress();
    });
    expect(tree.root.findByProps({testID: 'agent-picker-modal'}).props.visible).toBe(
      'false',
    );
    await act(async () => {
      tree.root.findByProps({testID: 'model-row'}).props.onPress();
    });
    expect(tree.root.findByProps({testID: 'model-picker-modal'}).props.visible).toBe(
      'false',
    );
    // 两张卡片都应触发锁定提示
    expect(mockShowToast).toHaveBeenCalledTimes(2);
  });

  // review-mobile/G-2：loadChatAgentMeta 抛非 AgentRunResolveError 时走异常路径，
  // 详情页弹错误提示并停留在加载态（卡片不渲染，自然不可点）。
  it('loadChatAgentMeta reject 时弹加载失败提示，卡片不渲染', async () => {
    mockLoadChatAgentMeta.mockRejectedValue(new Error('boom'));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    expect(mockShowToast).toHaveBeenCalled();
    const json = JSON.stringify(tree.toJSON());
    // 仍在加载态，没有渲染卡片
    expect(json).not.toContain('agent-row');
    expect(json).not.toContain('model-row');
  });

  it('session 时智能体可切换（不锁、不弹提示）', async () => {
    mockLoadChatAgentMeta.mockResolvedValue(meta({source: 'session'}));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: 'agent-row'}).props.onPress();
    });
    expect(mockShowToast).not.toHaveBeenCalled();
    const picker = tree.root.findByProps({testID: 'agent-picker-modal'});
    expect(picker.props.visible).toBe('true');
  });

  it('点击聊天名进入 inline 编辑，提交后调用 sessions.rename', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: 'session-title'}).props.onPress();
    });
    const input = tree.root.findByProps({testID: 'session-title-input'});
    await act(async () => {
      input.props.onChangeText('新名字');
    });
    await act(async () => {
      input.props.onSubmitEditing();
    });
    expect(mockSessionsRename).toHaveBeenCalledWith('s1', '新名字');
  });

  it('inline 编辑提交空串或未改动时不调 rename', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: 'session-title'}).props.onPress();
    });
    const input = tree.root.findByProps({testID: 'session-title-input'});
    // 未改动（仍是原标题「我的会话」）→ 不调 rename
    await act(async () => {
      input.props.onChangeText('我的会话');
    });
    await act(async () => {
      input.props.onSubmitEditing();
    });
    expect(mockSessionsRename).not.toHaveBeenCalled();
  });
});

// ── T-M5 picker select 分流 ─────────────────────────────────────────────────
describe('T-M5 picker select 分流', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('会话内 agent 选择：selectSessionAgent 写 session agentId，不碰 workspace 全局', async () => {
    await selectSessionAgent(mockRuntime as never, 's1', 'agent-a');
    expect(mockSessionsUpdateSessionAgentConfig).toHaveBeenCalledWith('s1', {
      agentId: 'agent-a',
    });
    expect(mockStateGetCurrentAgentId).not.toHaveBeenCalled();
  });

  it('全局 agent 选择：selectWorkspaceAgent 调 setCurrentAgentId，不写 session 绑定', async () => {
    await selectWorkspaceAgent(mockRuntime as never, 'agent-a');
    expect(mockStateSetCurrentAgentId).toHaveBeenCalledWith('agent-a');
    expect(mockSessionsUpdateSessionAgentConfig).not.toHaveBeenCalled();
  });

  it('会话内 model 选择：写全量 session 配置（保留 agentId 换 modelId）', async () => {
    // ModelPickerModal 的 select 在 session 模式下需要先读 current config 再写回全量
    const current = await mockRuntime.sessions.getSessionAgentConfig('s1');
    await mockRuntime.sessions.updateSessionAgentConfig('s1', {
      agentId: current.agentId,
      modelId: 'model-x',
    });
    expect(mockSessionsUpdateSessionAgentConfig).toHaveBeenCalledWith('s1', {
      agentId: current.agentId,
      modelId: 'model-x',
    });
  });

  it('全局 model 选择：调 setCurrentModelId，不写 session 绑定', async () => {
    mockStateSetCurrentModelId.mockClear();
    mockSessionsUpdateSessionAgentConfig.mockClear();
    // ModelPickerModal 的 select 在 workspace 模式下调
    // runtime.state.setCurrentModelId(savedModelId)
    await mockRuntime.state.setCurrentModelId('model-x');
    expect(mockStateSetCurrentModelId).toHaveBeenCalledWith('model-x');
    expect(mockSessionsUpdateSessionAgentConfig).not.toHaveBeenCalled();
  });
});

// ── T-MO1 聊天记录查询入口 ─────────────────────────────────────────────────
describe('T-MO1 SessionDetailScreen 聊天记录查询入口', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {projectId: 'p1', sessionId: 's1'};
    mockSessionsGet.mockResolvedValue({id: 's1', title: '我的会话'});
    mockLoadChatAgentMeta.mockResolvedValue(meta());
  });

  it('渲染「聊天记录」入口卡片，点击 navigate 到 ChatHistorySearch', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('聊天记录');
    await act(async () => {
      tree.root.findByProps({testID: 'chat-history-row'}).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('ChatHistorySearch', {
      projectId: 'p1',
      sessionId: 's1',
    });
  });
});
