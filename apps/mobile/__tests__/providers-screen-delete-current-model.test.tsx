/**
 * CR-F04（core2 A-1）：ProvidersScreen 删除服务商时的 currentModelId 软指针兜底。
 *
 * 牙齿：providers.delete 会级联抹掉该服务商名下的 saved model 行——若把
 *「取 currentModelId + 判归属」放在 delete **之后**，getSavedById 恒为 null，
 * resetCurrentModelId 永不执行，currentModelId 悬空固化进新会话的 agent_config_json，
 * 发消息才抛 INVALID_SAVED_MODEL_ID 且 UI 零解释。
 *
 * 下面的假 runtime 忠实模拟级联：providers.delete 真的抹掉该 provider 名下的模型行，
 * 所以「先判后删」与「先删后判」在这里分红——不是靠 mock 调用次数硬凑的。
 *
 * 依赖 core `DefaultProviderService.delete` 把 currentModelId 当软指针（不参与
 * SAVED_MODEL_IN_USE 前置拒绝）这半契约；cli / desktop 两端须保持同一顺序。
 */
import React from 'react';
import {Alert} from 'react-native';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      surface: '#f8f8f8',
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
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockReact.useEffect(cb, []);
    },
    useNavigation: () => ({navigate: jest.fn()}),
  };
});

jest.mock('@/components/batch/BatchCheckbox', () => ({
  BatchCheckbox: () => null,
}));
jest.mock('@/components/batch/ManageHeader', () => ({
  ManageHeader: () => null,
}));
jest.mock('@/components/provider/ApiKeyStatusTag', () => ({
  ApiKeyStatusTag: () => null,
}));
jest.mock('@/components/ui/Buttons', () => ({
  PrimaryButton: () => null,
}));
jest.mock('@/hooks/useDismissOverlaysOnBlur', () => ({
  useDismissOverlaysOnBlur: (_dismiss: () => void) => undefined,
}));

// ConfigListCard 暴露菜单按钮，驱动真实的 ConfigListCard.onMenuPress 链路。
jest.mock('@/components/ui/ConfigListCard', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    ConfigListCard: (props: {title?: string; onMenuPress?: () => void}) =>
      mockReact.createElement(
        Pressable,
        {testID: 'card'},
        mockReact.createElement(Text, null, props.title),
        props.onMenuPress
          ? mockReact.createElement(
              Pressable,
              {testID: 'card-menu', onPress: props.onMenuPress},
              mockReact.createElement(Text, null, 'menu'),
            )
          : null,
      ),
  };
});

// 底部菜单展开时渲染一个「删除」按钮，驱动 onSelect('delete')。
jest.mock('@/components/sheet/BottomSheetMenu', () => {
  const mockReact = require('react');
  const {Pressable, Text} = require('react-native');
  return {
    BottomSheetMenu: (props: {
      visible?: boolean;
      onSelect: (action: string) => void;
    }) =>
      props.visible
        ? mockReact.createElement(
            Pressable,
            {testID: 'menu-delete', onPress: () => props.onSelect('delete')},
            mockReact.createElement(Text, null, '删除'),
          )
        : null,
  };
});

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: jest.fn()}),
}));

interface FakeSaved {
  id: string;
  providerId: string;
}

/** 忠实模拟级联的假 runtime：delete 真的抹掉该 provider 名下的模型行。 */
function makeFakeRuntime() {
  const savedModels = new Map<string, FakeSaved>([
    ['M1', {id: 'M1', providerId: 'P1'}],
  ]);
  const state = {
    currentProviderId: 'P1' as string | undefined,
    currentModelId: 'M1' as string | undefined,
  };
  const callOrder: string[] = [];
  const runtime = {
    providers: {
      list: jest.fn(async () => [
        {id: 'P1', displayName: '网关甲', protocol: 'openai', apiKeyStatus: 'set'},
      ]),
      delete: jest.fn(async (providerId: string) => {
        callOrder.push('providers.delete');
        for (const [id, m] of [...savedModels]) {
          if (m.providerId === providerId) {
            savedModels.delete(id);
          }
        }
      }),
    },
    providerModels: {
      savedList: jest.fn(async () => []),
      getSavedById: jest.fn(async (id: string) => {
        callOrder.push('getSavedById');
        return savedModels.get(id) ?? null;
      }),
    },
    state: {
      getCurrentProviderId: jest.fn(async () => state.currentProviderId),
      getCurrentModelId: jest.fn(async () => state.currentModelId),
      resetCurrentProviderId: jest.fn(async () => {
        callOrder.push('resetCurrentProviderId');
        state.currentProviderId = undefined;
      }),
      resetCurrentModelId: jest.fn(async () => {
        callOrder.push('resetCurrentModelId');
        state.currentModelId = undefined;
      }),
    },
  };
  return {runtime, state, callOrder};
}

let mockFake = makeFakeRuntime();

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => mockFake.runtime,
}));

import {ProvidersScreen} from '@/screens/stack/ProvidersScreen';

/** 冲干净 deleteProviderOne 里那一串 await（Alert 回调是自调用 async，不会被 act 等到）。 */
async function flushAsync() {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

async function press(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    renderer.root.findByProps({testID}).props.onPress();
    await flushAsync();
  });
}

describe('ProvidersScreen 删除服务商清理 currentModelId（CR-F04）', () => {
  let alertSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    mockFake = makeFakeRuntime();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('CR-F04: currentModelId 指向被删服务商的模型时，删除后必须清空', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ProvidersScreen />);
    });

    // 行 → 底部菜单「删除」 → Alert 确认「删除」
    await press(renderer!, 'card-menu');
    await press(renderer!, 'menu-delete');

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0]![2]!;
    const confirm = buttons.find(b => b.text === '删除');
    expect(confirm).toBeDefined();

    await act(async () => {
      confirm!.onPress!();
      await flushAsync();
    });

    expect(mockFake.runtime.providers.delete).toHaveBeenCalledWith('P1');
    // currentModelId 指向已删模型 = 悬空指针，必须在删除成功后被清掉
    expect(mockFake.state.currentModelId).toBeUndefined();
    expect(mockFake.state.currentProviderId).toBeUndefined();

    // 顺序牙齿：归属判定必须发生在 delete 之前，否则 getSavedById 恒 null。
    expect(mockFake.callOrder.indexOf('getSavedById')).toBeGreaterThanOrEqual(0);
    expect(mockFake.callOrder.indexOf('getSavedById')).toBeLessThan(
      mockFake.callOrder.indexOf('providers.delete'),
    );
    expect(mockFake.callOrder.indexOf('resetCurrentModelId')).toBeGreaterThan(
      mockFake.callOrder.indexOf('providers.delete'),
    );
  });

  it('CR-F04: currentModelId 指向别家模型时不动它', async () => {
    // 反向对照：归属判定跑到了，但归属不匹配 ⇒ 不许误清别人的当前模型
    mockFake = makeFakeRuntime();
    mockFake.state.currentModelId = 'M1';
    mockFake.runtime.providerModels.getSavedById = jest.fn(async () => ({
      id: 'M1',
      providerId: 'P-OTHER',
    })) as never;

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ProvidersScreen />);
    });
    await press(renderer!, 'card-menu');
    await press(renderer!, 'menu-delete');
    const confirm = alertSpy.mock.calls[0]![2]!.find(b => b.text === '删除');
    await act(async () => {
      confirm!.onPress!();
      await flushAsync();
    });

    expect(mockFake.state.currentModelId).toBe('M1');
    expect(mockFake.runtime.state.resetCurrentModelId).not.toHaveBeenCalled();
  });
});