/**
 * workspace-push spec T-WP8（mobile）——TemplatePushButton 确认流：
 * - 点击弹确认：标题/文案明示覆盖模板母本，推送按钮 destructive；
 * - 取消不调用 pushTemplate；
 * - 确认调用 runtime.sessions.pushTemplate 且出「推送完成」 toast + onPushed。
 */
import React from 'react';
import {Alert} from 'react-native';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {TemplatePushButton} from '@/components/prompt/TemplatePushButton';

const alertSpy = jest.spyOn(Alert, 'alert');
const mockShowToast = jest.fn();
const mockPushTemplate = jest.fn();

jest.mock('@/hooks/useRuntime', () => ({
  useRuntime: () => ({
    sessions: {pushTemplate: mockPushTemplate},
  }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      border: '#222',
      text: '#fff',
      textSecondary: '#ccc',
      primary: '#08f',
      danger: '#f00',
    },
  }),
}));

jest.mock('@/components/chrome/ToastHost', () => ({
  useToast: () => ({showToast: mockShowToast}),
}));

jest.mock('@/errors/toast-message', () => ({
  toastMessage: (_title: string, err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

/** 取 Alert.alert 第 N 次调用的按钮数组。 */
function alertButtons(callIndex = 0): Array<{
  text: string;
  style?: string;
  onPress?: () => void;
}> {
  return (alertSpy.mock.calls[callIndex]?.[2] ?? []) as Array<{
    text: string;
    style?: string;
    onPress?: () => void;
  }>;
}

async function mountButton(onPushed?: () => void) {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <TemplatePushButton
        scope={{kind: 'session', sessionId: 's-1'}}
        onPushed={onPushed}
        iconOnly
      />,
    );
  });
  if (renderer == null) {
    throw new Error('渲染失败');
  }
  return renderer;
}

describe('TemplatePushButton 确认流（T-WP8）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('点击弹确认：文案明示覆盖模板母本，推送按钮 destructive', async () => {
    const renderer = await mountButton();
    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '推送到项目工作区'})
        .props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message] = alertSpy.mock.calls[0]!;
    expect(title).toBe('推送到项目工作区');
    expect(String(message)).toContain('将用当前聊天工作区覆盖项目工作区');
    expect(String(message)).toContain('模板母本');
    const buttons = alertButtons();
    expect(buttons.map(b => b.text)).toEqual(['取消', '推送']);
    expect(buttons[1]!.style).toBe('destructive');
    // 弹确认阶段不调用推送
    expect(mockPushTemplate).not.toHaveBeenCalled();
  });

  it('取消不调用 pushTemplate、不出 toast', async () => {
    const renderer = await mountButton();
    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '推送到项目工作区'})
        .props.onPress();
    });
    // 「取消」按钮无 onPress（RN Alert 风格约定，dismiss 即无事发生）；
    // 弹窗停留在待确认状态期间不得发生任何推送。
    expect(alertButtons()[0]!.onPress).toBeUndefined();
    expect(mockPushTemplate).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('确认调用 pushTemplate 并出「推送完成」 toast + onPushed 回调', async () => {
    const onPushed = jest.fn();
    const renderer = await mountButton(onPushed);
    await act(async () => {
      renderer.root
        .findByProps({accessibilityLabel: '推送到项目工作区'})
        .props.onPress();
    });
    mockPushTemplate.mockResolvedValueOnce(undefined);
    await act(async () => {
      alertButtons()[1]!.onPress!();
    });

    expect(mockPushTemplate).toHaveBeenCalledTimes(1);
    expect(mockPushTemplate).toHaveBeenCalledWith('s-1');
    expect(mockShowToast).toHaveBeenCalledWith('推送完成');
    expect(onPushed).toHaveBeenCalledTimes(1);
  });
});
