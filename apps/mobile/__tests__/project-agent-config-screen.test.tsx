import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {buildDefaultAgentDefinitionPreservingName} from '@novel-master/core/config-forms/stored-config-validity';

const mockShowToast = jest.fn();
const mockGetAgentConfig = jest.fn();
const mockUpdateAgentConfig = jest.fn();
const mockResolveCurrentAgentDefinition = jest.fn();
const mockRuntime = {
  projects: {
    getAgentConfig: mockGetAgentConfig,
    updateAgentConfig: mockUpdateAgentConfig,
  },
};

const globalDefinition = buildDefaultAgentDefinitionPreservingName('全局助手');

jest.mock('@novel-master/core', () => ({
  registerBuiltinTools: jest.fn(),
  ToolRegistry: class {
    list() {
      return ['read'];
    }
  },
}));

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: {projectId: 'proj-1'}}),
}));

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/hooks/useUnsavedGuard', () => ({
  useUnsavedGuard: jest.fn(),
}));

jest.mock('../src/services/agent-run.service', () => ({
  resolveCurrentAgentDefinition: (...args: unknown[]) =>
    mockResolveCurrentAgentDefinition(...args),
}));

jest.mock('../src/components/agent/AgentEditorForm', () => {
  const mockReact = require('react');
  return {
    AgentEditorForm: () =>
      mockReact.createElement('View', {testID: 'agent-editor-form'}, 'AgentEditorForm'),
  };
});

jest.mock('../src/components/form/FormSectionCard', () => {
  const mockReact = require('react');
  return {
    FormSectionCard: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      surfaceElevated: '#f5f5f5',
      borderLight: '#eee',
      primary: '#007aff',
      border: '#ddd',
    },
  }),
}));

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Alert: {alert: jest.fn()},
    Pressable: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      mockReact.createElement(
        'Pressable',
        {testID, onPress},
        children,
      ),
    StyleSheet: {
      create: (s: object) => s,
      hairlineWidth: 1,
    },
    Text: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => mockReact.createElement('Text', {testID}, children),
    View: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => mockReact.createElement('View', {testID}, children),
  };
});

jest.mock('../src/components/ui/SegmentedControl', () => {
  const mockReact = require('react');
  return {
    SegmentedControl: ({
      options,
      onChange,
    }: {
      options: {value: string; label: string; testID?: string}[];
      onChange: (value: string) => void;
    }) =>
      mockReact.createElement(
        'View',
        {testID: 'segmented-control'},
        options.map(option =>
          mockReact.createElement(
            'Pressable',
            {
              key: option.value,
              testID: option.testID,
              onPress: () => onChange(option.value),
            },
            option.label,
          ),
        ),
      ),
  };
});

import {ProjectAgentConfigScreen} from '../src/screens/stack/ProjectAgentConfigScreen';

describe('ProjectAgentConfigScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCurrentAgentDefinition.mockResolvedValue({
      agentId: 'default',
      definition: globalDefinition,
    });
    mockGetAgentConfig.mockResolvedValue({mode: 'follow'});
    mockUpdateAgentConfig.mockImplementation(async (_id, patch) => ({
      mode: patch.mode ?? 'follow',
      definition: patch.definition,
    }));
  });

  it('follow 模式展示全局 Agent 名称', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ProjectAgentConfigScreen />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const json = JSON.stringify(tree!.toJSON());
    expect(json).toContain('跟随全局智能体');
    expect(json).toContain('全局助手');
  });

  it('首次切自定义时克隆全局 Agent 并写入 updateAgentConfig', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ProjectAgentConfigScreen />);
      await Promise.resolve();
    });

    const customButton = tree!.root.findByProps({testID: 'project-agent-mode-custom'});
    await act(async () => {
      customButton.props.onPress();
      await Promise.resolve();
    });

    expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        mode: 'custom',
        definition: expect.objectContaining({name: '全局助手'}),
      }),
      expect.objectContaining({registeredToolNames: expect.any(Array)}),
    );
    expect(tree!.root.findByProps({testID: 'agent-editor-form'})).toBeTruthy();
  });

  it('已有 definition 时切自定义仅更新 mode', async () => {
    const existing = buildDefaultAgentDefinitionPreservingName('项目副本');
    mockGetAgentConfig.mockResolvedValue({
      mode: 'follow',
      definition: existing,
    });

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ProjectAgentConfigScreen />);
      await Promise.resolve();
    });

    const customButton = tree!.root.findByProps({testID: 'project-agent-mode-custom'});
    await act(async () => {
      customButton.props.onPress();
      await Promise.resolve();
    });

    expect(mockUpdateAgentConfig).toHaveBeenCalledWith(
      'proj-1',
      {mode: 'custom'},
      expect.objectContaining({registeredToolNames: expect.any(Array)}),
    );
  });
});
