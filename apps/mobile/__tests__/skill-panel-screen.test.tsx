/**
 * 会话技能面板空态容错测试。
 *
 * - NOT_FOUND（技能根目录尚不存在 = 空列表）静默显示空态，不弹错误 toast；
 * - 其他错误照常 toast「加载技能失败」。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {VfsError} from '@novel-master/core/vfs';
import {SkillPanelScreen} from '../src/screens/stack/SkillPanelScreen';

const mockEffectiveSkills = jest.fn();

const mockRuntime = {
  skills: () => ({
    effectiveSkills: mockEffectiveSkills,
    setDisabled: jest.fn(),
  }),
};

jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f5f5f5',
      surfaceElevated: '#fafafa',
      text: '#111',
      textSecondary: '#666',
      border: '#ddd',
      borderLight: '#eee',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

const mockShowToast = jest.fn();
jest.mock('../src/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('../src/errors/toast-message', () => ({
  toastMessage: (title: string, _err: unknown) => `${title}`,
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({params: {projectId: 'p1'}}),
  useNavigation: () => ({navigate: mockNavigate, goBack: jest.fn()}),
  // 面板靠 useFocusEffect 触发首次 reload；用 useEffect 语义避免每次渲染重触发
  useFocusEffect: (cb: () => void) =>
    require('react').useEffect(() => {
      cb();
    }, []),
}));

jest.mock('../src/components/skills/NewSkillModal', () => ({
  NewSkillModal: () => null,
}));

jest.mock('../src/components/ui/PrototypeButtons', () => ({
  SecondaryButton: () => null,
  PrimaryButton: () => null,
}));

jest.mock('react-native', () => {
  const RnReact = require('react');
  const View = ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
    RnReact.createElement('View', {testID}, children);
  const Text = ({children, testID}: {children?: React.ReactNode; testID?: string}) =>
    RnReact.createElement('Text', {testID}, children);
  return {
    View,
    Text,
    FlatList: ({
      data,
      ListEmptyComponent,
    }: {
      data: unknown[];
      ListEmptyComponent?: React.ReactNode;
    }) =>
      RnReact.createElement(
        'View',
        {testID: 'flat-list'},
        data != null && data.length === 0 ? ListEmptyComponent : null,
      ),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Switch: () => null,
    Pressable: (props: {children?: React.ReactNode; onPress?: () => void; testID?: string}) =>
      RnReact.createElement('View', {testID: props.testID}, props.children),
    StyleSheet: {
      create: (s: Record<string, unknown>) => s,
      hairlineWidth: 1,
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SkillPanelScreen 空态容错', () => {
  it('NOT_FOUND（技能根目录不存在）静默显示空态，不弹 toast', async () => {
    mockEffectiveSkills.mockRejectedValue(
      new VfsError('NOT_FOUND', 'vfs entry not found: /meta/skills'),
    );

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SkillPanelScreen />);
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    // 空态文案出现（而非报错）
    const json = renderer.toJSON();
    const texts = JSON.stringify(json);
    expect(texts).toContain('还没有可用技能');
  });

  it('其他错误照常 toast 加载失败', async () => {
    mockEffectiveSkills.mockRejectedValue(new Error('no such table: boom'));

    await act(async () => {
      TestRenderer.create(<SkillPanelScreen />);
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
