import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Alert} from 'react-native';

const mockListAgentIds = jest.fn();
const mockGetRawWire = jest.fn();
let capturedMenuOnSelect: ((action: string) => void) | undefined;

const agentId = 'agent-1730123456789';
const agentName = '我的写作助手';

const validWire = {
  schemaVersion: 1,
  name: agentName,
  prompts: {system: 'hi', persist: {}, dynamic: {}},
  runtime: {maxSteps: 5},
};

const mockRuntime = {
  agentRegistry: {
    listAgentIds: mockListAgentIds,
    getRawWire: mockGetRawWire,
  },
  state: {getCurrentModelId: jest.fn().mockResolvedValue(null)},
};

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surfaceElevated: '#f5f5f5',
      borderLight: '#eee',
      primary: '#007aff',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      bgSecondary: '#eee',
      warningMuted: '#fff3cd',
      warning: '#856404',
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

jest.mock('../src/provider/model-display-label', () => ({
  resolveModelDisplayLabel: jest.fn().mockResolvedValue('gpt-4'),
}));

jest.mock('../src/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: () => undefined,
}));

jest.mock('../src/hooks/useBatchSelection', () => ({
  useBatchSelection: () => ({
    active: false,
    selectedCount: 0,
    selectedIds: new Set<string>(),
    enter: jest.fn(),
    exit: jest.fn(),
    toggle: jest.fn(),
    isSelected: () => false,
  }),
}));

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    useNavigation: () => ({navigate: jest.fn()}),
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(() => cb(), []);
    },
  };
});

jest.mock('../src/components/batch/ManageHeader', () => {
  const mockReact = require('react');
  return {
    ManageHeader: () => mockReact.createElement('View', null, 'ManageHeader'),
  };
});

jest.mock('../src/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));

jest.mock('../src/components/ui/PrototypeButtons', () => ({
  PrimaryButton: () => null,
}));

jest.mock('../src/components/ui/TextPromptModal', () => ({
  TextPromptModal: () => null,
}));

jest.mock('../src/components/sheet/BottomSheetMenu', () => {
  const mockReact = require('react');
  return {
    BottomSheetMenu: ({
      visible,
      onSelect,
    }: {
      visible: boolean;
      onSelect: (action: string) => void;
    }) => {
      capturedMenuOnSelect = onSelect;
      return visible
        ? mockReact.createElement('View', {testID: 'bottom-sheet-menu'})
        : null;
    },
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Alert: {alert: jest.fn()},
    ActivityIndicator: () => mockReact.createElement('ActivityIndicator'),
    FlatList: ({
      data,
      renderItem,
      keyExtractor,
    }: {
      data: Array<{id: string}>;
      renderItem: (info: {item: {id: string}; index: number}) => React.ReactNode;
      keyExtractor: (item: {id: string}) => string;
    }) =>
      mockReact.createElement(
        'View',
        {testID: 'agent-flat-list'},
        data?.map((item, index) =>
          mockReact.createElement(
            'View',
            {key: keyExtractor(item), testID: `agent-row-${item.id}`},
            renderItem({item, index}),
          ),
        ),
      ),
    Pressable: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: (e?: {stopPropagation?: () => void}) => void;
      testID?: string;
    }) =>
      mockReact.createElement(
        'Pressable',
        {testID, onPress},
        children,
      ),
    RefreshControl: () => null,
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
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

import {AgentList} from '../src/components/agent/AgentList';

function findMenuDotsPressable(root: TestRenderer.ReactTestInstance) {
  const dotText = root
    .findAll(node => node.type === 'Text')
    .find(node => node.children?.includes('⋮'));
  if (dotText == null) {
    return undefined;
  }
  let node: TestRenderer.ReactTestInstance | null = dotText;
  while (node != null && node.type !== 'Pressable') {
    node = node.parent;
  }
  return node ?? undefined;
}

async function renderAndOpenDeleteMenu(wire: unknown) {
  mockListAgentIds.mockResolvedValue([agentId]);
  mockGetRawWire.mockResolvedValue(wire);
  capturedMenuOnSelect = undefined;

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AgentList />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(tree!.root.findByProps({testID: `agent-row-${agentId}`})).toBeDefined();

  const menuDots = findMenuDotsPressable(tree!.root);
  expect(menuDots).toBeDefined();
  await act(async () => {
    menuDots!.props.onPress?.({stopPropagation: jest.fn()});
  });
  expect(tree!.root.findByProps({testID: 'bottom-sheet-menu'})).toBeDefined();
  expect(capturedMenuOnSelect).toBeDefined();
  await act(async () => {
    capturedMenuOnSelect?.('delete');
  });
}

describe('AgentList delete confirm (T-AC3-1, T-AC3-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedMenuOnSelect = undefined;
  });

  it('单条删除确认展示 definition.name 而非裸 id', async () => {
    await renderAndOpenDeleteMenu(validWire);

    expect(Alert.alert).toHaveBeenCalledWith(
      '删除 Agent',
      `删除 Agent「${agentName}」？`,
      expect.any(Array),
    );
  });

  it('name 为空时回退 agentId', async () => {
    await renderAndOpenDeleteMenu({
      schemaVersion: 1,
      name: '   ',
      prompts: {blocks: {}},
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      '删除 Agent',
      `删除 Agent「${agentId}」？`,
      expect.any(Array),
    );
  });
});
