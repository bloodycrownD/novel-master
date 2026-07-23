import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockShowToast = jest.fn();
let capturedMenuOnSelect: ((action: string) => void) | undefined;

const sampleProjects = [
  {
    id: 'p1',
    name: '科幻',
    createdAtMs: 1,
    updatedAtMs: 2,
  },
];

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surface: '#fff',
      surfaceElevated: '#f5f5f5',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      borderLight: '#eee',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) => String(err),
}));

jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

import {ProjectDrawer} from '../src/components/chrome/ProjectDrawer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('../src/components/ui/AppModal', () => {
  const mockReact = require('react');
  return {
    AppModal: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', {testID: 'app-modal'}, children),
  };
});

jest.mock('../src/components/sheet/BottomSheetMenu', () => {
  const mockReact = require('react');
  return {
    BottomSheetMenu: ({
      visible,
      onSelect,
      items,
    }: {
      visible: boolean;
      onSelect: (action: string) => void;
      items: {action: string; label: string}[];
    }) => {
      if (visible) {
        capturedMenuOnSelect = onSelect;
      }
      return mockReact.createElement(
        'View',
        {testID: 'bottom-sheet-menu'},
        visible
          ? items.map(item =>
              mockReact.createElement(
                'Pressable',
                {
                  key: item.action,
                  testID: `menu-${item.action}`,
                  onPress: () => onSelect(item.action),
                },
                item.label,
              ),
            )
          : null,
      );
    },
  };
});

jest.mock('../src/components/ui/TextPromptModal', () => ({
  TextPromptModal: () => null,
}));

jest.mock('../src/components/batch/ManageHeader', () => {
  const mockReact = require('react');
  return {
    ManageHeader: () => mockReact.createElement('View', null, 'ManageHeader'),
  };
});

jest.mock('../src/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));

jest.mock('../src/components/ui/PrototypeButtons', () => {
  const mockReact = require('react');
  return {
    PrimaryButton: () => mockReact.createElement('View', null, 'PrimaryButton'),
  };
});

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
    ScrollView: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('ScrollView', null, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', null, children),
    View: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => mockReact.createElement('View', {testID}, children),
  };
});

describe('ProjectDrawer agent config entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedMenuOnSelect = undefined;
  });

  it('项目菜单包含智能体并触发 onOpenAgentConfig', async () => {
    const onOpenAgentConfig = jest.fn();

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ProjectDrawer
          visible
          projects={sampleProjects}
          currentProjectId="p1"
          onClose={jest.fn()}
          onSelect={jest.fn()}
          onCreateProject={jest.fn()}
          onRenameProject={jest.fn()}
          onDeleteSelected={jest.fn()}
          onOpenAgentConfig={onOpenAgentConfig}
        />,
      );
    });

    const menuTrigger = tree!.root.findByProps({testID: 'project-menu-p1'});
    await act(async () => {
      menuTrigger.props.onPress({stopPropagation: jest.fn()});
    });

    expect(capturedMenuOnSelect).toBeDefined();
    await act(async () => {
      capturedMenuOnSelect?.('agent-config');
    });

    expect(onOpenAgentConfig).toHaveBeenCalledWith('p1');
  });
});
