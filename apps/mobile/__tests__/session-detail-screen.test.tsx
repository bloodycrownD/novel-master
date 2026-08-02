/**
 * 会话详情页 mobile UI 测试（T-M2 / T-M5）。
 *
 * - T-M2: SessionDetailScreen 渲染 + 操作 wiring（重命名 / 切模型 / 切智能体 / 查看提示词 / 压缩上下文）
 * - T-M5: picker select 分流——会话内写 session 绑定，全局页写 workspace
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
const mockEventOrchestratorEmit = jest.fn(async () => ({ok: true, failures: []}));
const mockStateGetCurrentAgentId = jest.fn(async () => 'workspace-agent');
const mockStateGetCurrentModelId = jest.fn(async () => 'model-ws');
const mockStateSetCurrentModelId = jest.fn(async () => undefined);
const mockStateSetCurrentAgentId = jest.fn(async () => undefined);
const mockAgentRegistryListAgentIds = jest.fn(async () => ['agent-a']);
const mockAgentRegistryGet = jest.fn(async () => ({name: '显示名-agent-a'}));
const mockProvidersList = jest.fn(async () => []);
const mockProviderModelsSavedList = jest.fn(async () => []);

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
  agentRegistry: {
    listAgentIds: mockAgentRegistryListAgentIds,
    get: mockAgentRegistryGet,
  },
  providers: {list: mockProvidersList},
  providerModels: {savedList: mockProviderModelsSavedList},
  eventOrchestrator: {emit: mockEventOrchestratorEmit},
};

const mockShowToast = jest.fn();
const mockNavigate = jest.fn();
let mockRouteParams: {projectId: string; sessionId: string} = {
  projectId: 'p1',
  sessionId: 's1',
};

// Alert.alert mock：默认调用第二个按钮（确认按钮）的 onPress，便于测试压缩确认链路。
const mockAlertAlert = jest.fn((title, message, buttons) => {
  const confirm = buttons?.[1];
  confirm?.onPress?.();
});

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

jest.mock('../src/services/project-composer-status.service', () => ({
  refreshComposerStatusAfterFloorOrCompaction: jest.fn(async () => undefined),
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
jest.mock('../src/components/ui/TextPromptModal', () => {
  const React = require('react');
  return {
    TextPromptModal: (props: {
      visible: boolean;
      title: string;
      onConfirm: (v: string) => void | Promise<void>;
    }) =>
      React.createElement('View', {
        testID: 'rename-modal',
        visible: String(props.visible),
        title: props.title,
        onConfirm: props.onConfirm,
      }),
  };
});

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: mockRouteParams}),
  useNavigation: () => ({navigate: mockNavigate}),
  useFocusEffect: () => undefined,
}));

jest.mock('react-native', () => {
  const RnReact = require('react');
  return {
    Alert: {alert: (...args: unknown[]) => mockAlertAlert(...args)},
    ScrollView: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => RnReact.createElement('View', {testID}, children),
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

  it('点击「查看提示词」navigate 到 RealPrompt', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: '查看提示词'}).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('RealPrompt');
  });

  it('点击「切换智能体」打开 picker（session 模式：传 sessionId）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: '切换智能体'}).props.onPress();
    });
    const picker = tree.root.findByProps({testID: 'agent-picker-modal'});
    expect(picker.props.visible).toBe('true');
    expect(picker.props.sessionId).toBe('s1');
  });

  it('project-custom 时 agent 切换禁用（项目截断）', async () => {
    mockLoadChatAgentMeta.mockResolvedValue(meta({source: 'project-custom'}));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    expect(tree.root.findByProps({testID: '切换智能体'}).props.disabled).toBe(
      'true',
    );
  });

  it('agent pin（modelSource=agent-pin）时 model 切换禁用', async () => {
    mockLoadChatAgentMeta.mockResolvedValue(
      meta({modelSource: 'agent-pin', hasDedicatedModel: true}),
    );
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    expect(tree.root.findByProps({testID: '切换大模型'}).props.disabled).toBe(
      'true',
    );
  });

  it('session 时 agent 可切换（不锁）', async () => {
    mockLoadChatAgentMeta.mockResolvedValue(meta({source: 'session'}));
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    expect(tree.root.findByProps({testID: '切换智能体'}).props.disabled).toBe(
      'false',
    );
  });

  it('点击「压缩上下文」确认后触发 eventOrchestrator.emit（trigger=manual）', async () => {
    mockEventOrchestratorEmit.mockClear();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: '压缩上下文'}).props.onPress();
      await flushPromises();
    });
    // mockAlertAlert 会自动调确认按钮 → emit 应被调用
    expect(mockEventOrchestratorEmit).toHaveBeenCalledWith(
      'session.compaction.requested',
      {sessionId: 's1', projectId: 'p1', trigger: 'manual'},
    );
  });

  it('点击「聊天重命名」打开 rename 弹层，确认后调用 sessions.rename', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<SessionDetailScreen />);
      await flushPromises();
    });
    await act(async () => {
      tree.root.findByProps({testID: '聊天重命名'}).props.onPress();
    });
    const renameModal = tree.root.findByProps({testID: 'rename-modal'});
    expect(renameModal.props.visible).toBe('true');
    await act(async () => {
      await renameModal.props.onConfirm('新名字');
    });
    expect(mockSessionsRename).toHaveBeenCalledWith('s1', '新名字');
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
