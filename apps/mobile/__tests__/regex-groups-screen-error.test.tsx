/**
 * RegexGroupsScreen 列表加载错误态（cr-fix-spec b2/B-1）：
 * 加载失败渲染错误文案 + 重试，不再吞错伪装成空态；重试成功恢复列表。
 *
 * 照 fetch-models-sheet.test.tsx 的 TestRenderer 直测风格；
 * 重型子组件与 navigation mock 掉，只驱动列表数据流。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f8f8f8',
      surfaceElevated: '#fff',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      border: '#ccc',
      borderLight: '#e0e0e0',
      primary: '#007aff',
      danger: '#f00',
    },
  }),
}));

jest.mock('@react-navigation/native', () => {
  const mockReact = require('react');
  return {
    // 挂载时执行一次，对齐真实 focus 语义（每渲染都跑会触发 reload 无限循环）
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, []);
    },
    useNavigation: () => ({navigate: jest.fn()}),
  };
});

jest.mock('@novel-master/core/format', () => ({
  deriveRegexGroupId: (name: string) => `id-${name}`,
}));

jest.mock('@/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));
jest.mock('@/components/batch/ManageHeader', () => ({
  ManageHeader: () => null,
}));
jest.mock('@/components/regex/RegexGroupPickerModal', () => ({
  RegexGroupPickerModal: () => null,
}));
jest.mock('@/components/sheet/BottomSheetMenu', () => ({
  BottomSheetMenu: () => null,
}));
jest.mock('@/components/ui/ListSectionTitle', () => ({
  ListSectionTitle: () => null,
}));
jest.mock('@/components/ui/PrototypeButtons', () => ({
  PrimaryButton: () => null,
}));
jest.mock('@/components/ui/TextPromptModal', () => ({
  TextPromptModal: () => null,
}));
jest.mock('@/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: (_dismiss: () => void) => undefined,
}));

jest.mock('@/components/ui/ConfigListCard', () => {
  const mockReact = require('react');
  const {Text} = require('react-native');
  return {
    ConfigListCard: (props: {title?: string; subtitle?: string}) =>
      mockReact.createElement(Text, null, `${props.title}:${props.subtitle}`),
  };
});

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

const mockListGroups = jest.fn();
const mockGetGroup = jest.fn();
const mockListRules = jest.fn();
const mockGetCurrentRegexGroupId = jest.fn();

const mockRuntime = {
  regexConfig: {
    listGroups: mockListGroups,
    getGroup: mockGetGroup,
    listRules: mockListRules,
  },
  state: {getCurrentRegexGroupId: mockGetCurrentRegexGroupId},
};

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import {RegexGroupsScreen} from '@/screens/stack/RegexGroupsScreen';

/** 递归收集渲染树里全部展示文本（避开 toJSON 的循环引用）。 */
function treeText(
  node: TestRenderer.ReactTestInstance | string | number,
): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  let out = '';
  for (const child of node.children) {
    out += treeText(child);
  }
  return out;
}

function json(renderer: TestRenderer.ReactTestRenderer) {
  return treeText(renderer.root);
}

/** 找按钮文案精确等于 text 的可点击节点。 */
function findButtonByText(
  root: TestRenderer.ReactTestInstance,
  text: string,
): TestRenderer.ReactTestInstance | undefined {
  return root
    .findAll(n => n.props && typeof n.props.onPress === 'function')
    .find(node => treeText(node).trim() === text);
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<RegexGroupsScreen />);
  });
  return {renderer: renderer!};
}

const GROUPS = [{groupId: 'g1', displayName: '对话清洗'}];

describe('RegexGroupsScreen 列表加载错误态', () => {
  beforeEach(() => {
    mockListGroups.mockReset().mockResolvedValue(GROUPS);
    mockGetGroup.mockReset().mockResolvedValue({groupId: 'g1'});
    mockListRules.mockReset().mockResolvedValue([]);
    mockGetCurrentRegexGroupId.mockReset().mockResolvedValue(undefined);
  });

  it('B-1: 加载失败渲染错误文案与重试，空态文案不出现', async () => {
    mockListGroups.mockRejectedValueOnce(new Error('正则组读取失败'));
    const {renderer} = await renderScreen();
    const text = json(renderer);
    expect(text).toContain('正则组读取失败');
    expect(text).toContain('重试');
    expect(text).not.toContain('暂无正则组');
  });

  it('B-1: 点重试成功后恢复列表', async () => {
    mockListGroups
      .mockRejectedValueOnce(new Error('正则组读取失败'))
      .mockResolvedValueOnce(GROUPS);
    const {renderer} = await renderScreen();
    expect(json(renderer)).toContain('正则组读取失败');

    await act(async () => {
      findButtonByText(renderer.root, '重试')!.props.onPress();
    });
    expect(json(renderer)).toContain('对话清洗');
    expect(json(renderer)).not.toContain('正则组读取失败');
  });

  it('B-1: 真无数据时仍显示空态', async () => {
    mockListGroups.mockResolvedValueOnce([]);
    const {renderer} = await renderScreen();
    const text = json(renderer);
    expect(text).toContain('暂无正则组');
    expect(text).not.toContain('重试');
  });
});
