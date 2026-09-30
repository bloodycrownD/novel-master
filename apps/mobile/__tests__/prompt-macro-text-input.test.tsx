/**
 * T-MAC-W1..6：宏壳（PromptMacroTextInput）WebView 协议版。
 *
 * main 版仅 1 例「value+children 不变量」守门，随 FormTextInput + children 着色链
 * 退役；断言面换成桥消息（mock WebView 的 `mockWebViewPostMessages`）与 RN 侧
 * 外壳/chips 样式——mock 范式照 `__tests__/composer-input-webview.test.tsx`
 * （jest.config 全局映射 `test-utils/react-native-webview-mock.tsx`）。
 *
 * 纯函数层（`prompt-macro-input.test.ts` 13 例）不动，是本次单源复用的地基。
 */
import React from 'react';
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import {Platform, StyleSheet} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeHostToComposerInput,
  type ComposerInputInitPayload,
  type HostToComposerInputMessage,
} from '@/components/chat/ComposerInputBridge';
import {PromptMacroTextInput} from '@/components/agent/PromptMacroTextInput';
import {PROMPT_INSERTABLE_MACROS} from '@/components/agent/prompt-macro-input';
import {lightTheme} from '@/theme/tokens';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';

// 宿主内部会调 useTheme（宏壳主题走 props.tokens 通道），mock 掉 provider 依赖。
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      borderLight: '#222',
      text: '#fff',
      textSecondary: '#ccc',
      primary: '#08f',
      selection: '#08f55',
    },
  }),
}));

// URI helper 在 Android 走恒定案串，避免 Jest 默认 iOS 依赖 Bundle 路径。
Object.defineProperty(Platform, 'OS', {
  configurable: true,
  get: () => 'android',
});

type WebViewMockComponent = React.ComponentType<{
  onMessage?: (event: {nativeEvent: {data: string}}) => void;
}>;

function webViewType(): WebViewMockComponent {
  return require('react-native-webview').default as WebViewMockComponent;
}

function findWebView(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance {
  return root.findByType(webViewType() as React.ComponentType<unknown>);
}

/** 模拟 web → host 上报（信封 v 取本包 BRIDGE_V）。 */
function simulateWebMessage(
  root: TestRenderer.ReactTestInstance,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  const webView = findWebView(root);
  act(() => {
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({v: COMPOSER_INPUT_BRIDGE_VERSION, type, payload}),
      },
    });
  });
}

function simulateWebReady(root: TestRenderer.ReactTestInstance): void {
  simulateWebMessage(root, 'ready', {version: COMPOSER_INPUT_BRIDGE_VERSION});
}

/** 冲净 effect 与异步批（不依赖同步时序）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

function messagesSince(clearAfterIndex: number): HostToComposerInputMessage[] {
  return mockWebViewPostMessages
    .slice(clearAfterIndex)
    .map(raw => decodeHostToComposerInput(raw));
}

function typesSince(clearAfterIndex: number): string[] {
  return messagesSince(clearAfterIndex).map(message => message.type);
}

function payloadOfType(clearAfterIndex: number, type: string): unknown {
  const found = messagesSince(clearAfterIndex).find(
    message => message.type === type,
  );
  return found == null ? null : found.payload;
}

async function render(
  element: React.ReactElement,
): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

/** 按 chip 文案定位 Pressable（chips 无 testID，用仓库既有的按文案找范式）。 */
function findChipByLabel(
  root: TestRenderer.ReactTestInstance,
  label: string,
): TestRenderer.ReactTestInstance {
  const found = root.findAll(
    node =>
      typeof node.props?.onPress === 'function' &&
      node.findAll(inst => inst.props?.children === label).length > 0,
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

describe('PromptMacroTextInput 宏壳（T-MAC-W1..6）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(() => {
    clearMockWebViewPostMessages();
  });

  it('T-MAC-W1: value 直控渲染不抛，长文在 ready 后整段 setText 下发 web', async () => {
    const longText = Array.from(
      {length: 20},
      (_, index) => `第 ${index + 1} 行 {{$time}} 尾巴`,
    ).join('\n');

    const tree = await render(
      <PromptMacroTextInput
        tokens={lightTheme}
        value={longText}
        onChangeText={() => {}}
      />,
    );
    expect(findWebView(tree.root)).toBeTruthy();

    simulateWebReady(tree.root);
    await flush();

    // 挂载即带长文：ready 后 value 差分把整段写进 web（直控；main 的
    // 「value 与 children 互斥」不变量问题随 children 着色链一起消失）。
    expect(typesSince(0)[0]).toBe('init');
    expect(payloadOfType(0, 'setText')).toEqual({text: longText});
  });

  it('T-MAC-W2: init 载荷（mode/theme/metrics；maxHeight 从透传 style 提取，无则 null）', async () => {
    const tree = await render(
      <PromptMacroTextInput
        tokens={lightTheme}
        value=""
        onChangeText={() => {}}
        placeholder="支持 $time、$week_cn、$filetree…"
        style={{maxHeight: 176}}
      />,
    );

    simulateWebReady(tree.root);
    await flush();

    expect(payloadOfType(0, 'init')).toEqual({
      mode: 'prompt-macro',
      disabled: false,
      theme: {
        background: lightTheme.background,
        text: lightTheme.text,
        textSecondary: lightTheme.textSecondary,
        primary: lightTheme.primary,
        primaryMuted: `${lightTheme.primary}22`,
        selection: lightTheme.selection,
      },
      metrics: {
        fontSize: 16,
        lineHeight: 22,
        paddingH: 14,
        paddingV: 12,
        minHeight: 88,
        maxHeight: 176,
      },
      placeholder: '支持 $time、$week_cn、$filetree…',
    });

    // 未透传限高样式 → maxHeight null（宿主按「不限高」语义渲染）
    const bareBaseline = mockWebViewPostMessages.length;
    const bareTree = await render(
      <PromptMacroTextInput
        tokens={lightTheme}
        value=""
        onChangeText={() => {}}
      />,
    );
    simulateWebReady(bareTree.root);
    await flush();

    const bareInit = payloadOfType(
      bareBaseline,
      'init',
    ) as ComposerInputInitPayload;
    expect(bareInit.metrics).toMatchObject({minHeight: 88});
    expect(bareInit.metrics.maxHeight).toBeNull();
  });

  it('T-MAC-W3: chips 点击 → 宿主 setText{text, selection}（插入基点取 web 上报选区）', async () => {
    const onChangeText = jest.fn();
    const tree = await render(
      <PromptMacroTextInput
        tokens={lightTheme}
        value="前缀后缀"
        onChangeText={onChangeText}
      />,
    );

    simulateWebReady(tree.root);
    await flush();

    // 用户已在 web 内把光标落到 2..2（chips 以此为插入基点）
    simulateWebMessage(tree.root, 'selectionChange', {start: 2, end: 2});

    const macro = PROMPT_INSERTABLE_MACROS[0];
    const baseline = mockWebViewPostMessages.length;
    await act(async () => {
      findChipByLabel(tree.root, macro.label).props.onPress();
    });
    await flush();

    const expected = `前缀${macro.token}后缀`;
    const caret = 2 + macro.token.length;
    expect(payloadOfType(baseline, 'setText')).toEqual({
      text: expected,
      selectionStart: caret,
      selectionEnd: caret,
    });
    // 程序化写入同步回调 onChangeText（外层表单状态靠它同步）
    expect(onChangeText).toHaveBeenCalledWith(expected);
    // 光标经 setText.selection 一次落位：pendingSelection 与宿主基线同值，无回声 setSelection
    expect(
      typesSince(baseline).filter(type => type === 'setSelection'),
    ).toEqual([]);
  });

  it('T-MAC-W4: disabled=true → init.disabled 下发 + chips 禁点灰显；disabled 变化 → setDisabled', async () => {
    const renderShell = (disabled: boolean) => (
      <PromptMacroTextInput
        tokens={lightTheme}
        value=""
        onChangeText={() => {}}
        disabled={disabled}
      />
    );
    const tree = await render(renderShell(true));

    simulateWebReady(tree.root);
    await flush();

    expect(payloadOfType(0, 'init')).toMatchObject({
      mode: 'prompt-macro',
      disabled: true,
    });

    // chips 灰显与禁点留在 RN 壳（输入区 readOnly 走 web）
    const macro = PROMPT_INSERTABLE_MACROS[0];
    const disabledChip = findChipByLabel(tree.root, macro.label);
    expect(StyleSheet.flatten(disabledChip.props.style).opacity).toBe(0.55);
    expect(disabledChip.props.disabled).toBe(true);

    // 解除只读（详情 → 编辑）→ setDisabled，不重发 init
    const enableBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell(false));
    });
    await flush();
    expect(payloadOfType(enableBaseline, 'setDisabled')).toEqual({
      disabled: false,
    });
    expect(typesSince(enableBaseline)).not.toContain('init');
    expect(
      StyleSheet.flatten(findChipByLabel(tree.root, macro.label).props.style)
        .opacity,
    ).toBeUndefined();
    expect(findChipByLabel(tree.root, macro.label).props.disabled).toBe(false);

    // 再回只读（编辑 → 详情）
    const disableBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell(true));
    });
    await flush();
    expect(payloadOfType(disableBaseline, 'setDisabled')).toEqual({
      disabled: true,
    });
    expect(
      StyleSheet.flatten(findChipByLabel(tree.root, macro.label).props.style)
        .opacity,
    ).toBe(0.55);
  });

  it('T-MAC-W5: 外部 selection={0,0} 一拍 → 宿主 setSelection 下发（挂载视口置顶语义）', async () => {
    const renderShell = (selection?: {start: number; end: number}) => (
      <PromptMacroTextInput
        tokens={lightTheme}
        value="长文正文"
        onChangeText={() => {}}
        selection={selection}
      />
    );
    const tree = await render(renderShell(undefined));

    simulateWebReady(tree.root);
    await flush();

    // ExpandablePromptInput 挂载后一拍置 {0,0}：合并结果经宿主 selection prop 下发
    const baseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell({start: 0, end: 0}));
    });
    await flush();

    expect(payloadOfType(baseline, 'setSelection')).toEqual({start: 0, end: 0});
  });

  it('T-MAC-W6: 表单外壳样式（hairline 边框 / 圆角 12 / bgSecondary 底）且内部包宿主', async () => {
    const tree = await render(
      <PromptMacroTextInput
        tokens={lightTheme}
        value=""
        onChangeText={() => {}}
        style={{maxHeight: 176}}
      />,
    );

    const shell = tree.root
      .findAll(
        node => StyleSheet.flatten(node.props?.style)?.borderRadius === 12,
      )
      .find(
        node =>
          node.findAllByType(webViewType() as React.ComponentType<unknown>)
            .length >= 1,
      );
    expect(shell).toBeDefined();

    const flat = StyleSheet.flatten(shell!.props.style);
    expect(flat.borderWidth).toBe(StyleSheet.hairlineWidth);
    expect(flat.borderRadius).toBe(12);
    expect(flat.borderColor).toBe(lightTheme.borderLight);
    expect(flat.backgroundColor).toBe(lightTheme.bgSecondary);

    // 外壳里包着宿主容器（高度初值 = metrics.minHeight 88）
    const container = tree.root
      .findAll(node => StyleSheet.flatten(node.props?.style)?.height === 88)
      .find(
        node =>
          node.findAllByType(webViewType() as React.ComponentType<unknown>)
            .length >= 1,
      );
    expect(container).toBeDefined();
  });
});
