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

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: mockRouteParams}),
  useNavigation: () => ({navigate: jest.fn()}),
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

  it('渲染聊天名 / agent / model 来源标签', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('我的会话');
    expect(json).toContain('Alpha');
    expect(json).toContain('Model-1');
    // session source → 「会话引用」标签
    expect(json).toContain('会话引用');
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

  it('project-custom 时点击智能体卡片不进 picker，弹锁定提示', async () => {
    mockLoadChatAgentMeta.mockResolvedValue(meta({source: 'project-custom'}));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
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
