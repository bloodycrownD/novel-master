import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';
import {STORED_CONFIG_LABELS} from '@novel-master/core/config-forms/stored-config-validity';

const mockGetRawWire = jest.fn();
const mockListAgentIds = jest.fn();
const mockGoBack = jest.fn();

const agentId = 'agent-broken-001';
const agentName = '失效写作助手';

const invalidWireWithName = {
  schemaVersion: 1,
  name: agentName,
  prompts: {blocks: {}},
};

const mockRuntime = {
  agentRegistry: {
    getRawWire: mockGetRawWire,
    listAgentIds: mockListAgentIds,
    delete: jest.fn(),
  },
  providers: {list: jest.fn().mockResolvedValue([])},
  providerModels: {
    savedList: jest.fn().mockResolvedValue([]),
    getSavedById: jest.fn().mockResolvedValue(null),
  },
  state: {getCurrentModelId: jest.fn().mockResolvedValue(null)},
};

jest.mock('@novel-master/core', () => ({
  registerBuiltinTools: jest.fn(),
  ToolRegistry: class {
    list() {
      return ['read'];
    }
  },
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      surface: '#fff',
      border: '#ddd',
      primary: '#007aff',
      danger: '#ff3b30',
    },
  }),
}));

const mockShowToast = jest.fn();

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: mockGoBack}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('../src/components/form/FormOverlayHost', () => ({
  useFormOverlay: () => ({openOverlay: jest.fn()}),
}));

jest.mock('../src/components/form/FormField', () => {
  const mockReact = require('react');
  return {
    FormField: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

jest.mock('../src/components/form/FormSwitchRow', () => ({
  FormSwitchRow: () => null,
}));

jest.mock('../src/components/form/FormSectionCard', () => {
  const mockReact = require('react');
  return {
    FormSectionCard: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

jest.mock('../src/components/form/FormSelectField', () => ({
  FormSelectField: () => null,
}));

jest.mock('../src/components/form/FormTextInput', () => ({
  FormTextInput: () => null,
}));

jest.mock('../src/components/form/ScreenFormLayout', () => {
  const mockReact = require('react');
  return {
    ScreenFormLayout: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

jest.mock('../src/components/form/StickyFormFooter', () => ({
  StickyFormFooter: () => null,
}));

jest.mock('../src/components/agent/ToolPolicyPicker', () => ({
  ToolPolicyPicker: () => null,
}));

jest.mock('../src/components/agent/PromptMacroTextInput', () => ({
  PromptMacroTextInput: () => null,
}));

jest.mock('../src/services/agent-yaml.service', () => ({
  exportAgentYaml: jest.fn(),
  importAgentYaml: jest.fn(),
}));

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Alert: {alert: jest.fn()},
    Pressable: ({
      children,
      onPress,
      disabled,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) =>
      mockReact.createElement(
        'Pressable',
        {onPress: disabled ? undefined : onPress},
        children,
      ),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Switch: () => null,
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', null, children),
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

import {AgentEditorForm} from '../src/components/agent/AgentEditorForm';

async function renderInvalidEditor(wire: unknown) {
  mockGetRawWire.mockResolvedValue(wire);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AgentEditorForm agentId={agentId} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree!;
}

function pressDeleteButton(root: TestRenderer.ReactTestInstance) {
  const deleteLabel = STORED_CONFIG_LABELS.agentDelete;
  const deletePressable = root
    .findAll(node => node.type === 'Pressable')
    .find(node =>
      node.findAllByType('Text' as never).some(t => t.children?.includes(deleteLabel)),
    );
  expect(deletePressable).toBeDefined();
  act(() => {
    deletePressable!.props.onPress?.();
  });
}

describe('AgentEditorForm delete confirm (T-AC3-2, T-AC3-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('失效配置删除确认展示 wire 解析的 name', async () => {
    const tree = await renderInvalidEditor(invalidWireWithName);
    pressDeleteButton(tree.root);

    expect(Alert.alert).toHaveBeenCalledWith(
      '删除 Agent',
      `删除 Agent「${agentName}」？`,
      expect.any(Array),
    );
  });

  it('wire 无有效 name 时回退 agentId', async () => {
    const tree = await renderInvalidEditor({
      schemaVersion: 1,
      prompts: {blocks: {}},
    });
    pressDeleteButton(tree.root);

    expect(Alert.alert).toHaveBeenCalledWith(
      '删除 Agent',
      `删除 Agent「${agentId}」？`,
      expect.any(Array),
    );
  });
});
