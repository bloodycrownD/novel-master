/**
 * T-HOST1..6：composer 输入 WebView 通用宿主 + chat 壳契约。
 *
 * 断言面是桥消息（mock WebView 的 `mockWebViewPostMessages`）与壳合成的 RN
 * 事件形状——mock 范式照 `__tests__/chat-transcript-webview.test.tsx`
 * （jest.config 全局映射 `test-utils/react-native-webview-mock.tsx`）。
 *
 * T-HOST7/8 为附加覆盖：高度跟随（容器高度所有权）与「打字不回写」真源防线。
 */
import React from 'react';
import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import {Platform, StyleSheet} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeHostToComposerInput,
  type ComposerInputMetrics,
  type ComposerInputSelection,
  type HostToComposerInputMessage,
} from '@/components/chat/ComposerInputBridge';
import {ComposerInputWebView} from '@/components/chat/ComposerInputWebView';
import {
  ComposerAtPathInput,
  type ComposerAtPathInputHandle,
} from '@/components/chat/ComposerAtPathInput';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';

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

/** chat 壳（ComposerAtPathInput）的默认 metrics 组装口径。 */
const CHAT_METRICS: ComposerInputMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 160,
};

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

function payloadOfType(
  clearAfterIndex: number,
  type: string,
): unknown {
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

describe('ComposerInputWebView / ComposerAtPathInput（T-HOST1..6）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(() => {
    clearMockWebViewPostMessages();
  });

  it('T-HOST1: web 上报 selectionChange → 壳合成 RN 事件形状（nativeEvent.selection.start）', async () => {
    const onSelectionChange = jest.fn();
    const tree = await render(
      <ComposerAtPathInput
        value=""
        onChangeText={() => {}}
        onSelectionChange={onSelectionChange}
      />,
    );

    simulateWebReady(tree.root);
    await flush();
    onSelectionChange.mockClear();

    simulateWebMessage(tree.root, 'selectionChange', {start: 3, end: 5});

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const event = onSelectionChange.mock.calls[0][0];
    expect(event.nativeEvent.selection.start).toBe(3);
    expect(event.nativeEvent.selection.end).toBe(5);
  });

  it('T-HOST2: replaceCommittedText → setText{text, selection} 下发（省略光标落末位）', async () => {
    const onChangeText = jest.fn();
    const handleRef = React.createRef<ComposerAtPathInputHandle>();
    const tree = await render(
      <ComposerAtPathInput
        ref={handleRef}
        value=""
        onChangeText={onChangeText}
      />,
    );

    simulateWebReady(tree.root);
    await flush();

    const baseline = mockWebViewPostMessages.length;
    act(() => {
      handleRef.current?.replaceCommittedText('见 @/a.md ', 9);
    });
    await flush();

    expect(payloadOfType(baseline, 'setText')).toEqual({
      text: '见 @/a.md ',
      selectionStart: 9,
      selectionEnd: 9,
    });
    // main 版同口径：程序化写入回调 onChangeText（ChatComposer 状态同步）
    expect(onChangeText).toHaveBeenCalledWith('见 @/a.md ');

    const noCursorBaseline = mockWebViewPostMessages.length;
    act(() => {
      handleRef.current?.replaceCommittedText('整段');
    });
    await flush();
    expect(payloadOfType(noCursorBaseline, 'setText')).toEqual({
      text: '整段',
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it('T-HOST3: 外部 value 差分 → setText（水化 / 清空），光标期望随受控 selection 对齐', async () => {
    const renderShell = (value: string) => (
      <ComposerAtPathInput value={value} onChangeText={() => {}} />
    );
    const tree = await render(renderShell(''));

    simulateWebReady(tree.root);
    await flush();

    // 水化：value 从 '' 变非空 → setText 全量写入
    const hydrateBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell('水化文本'));
    });
    await flush();
    expect(payloadOfType(hydrateBaseline, 'setText')).toEqual({
      text: '水化文本',
    });
    expect(typesSince(hydrateBaseline)).toContain('setSelection');

    // 清空：value 主动变化 → 再次 setText
    const clearBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell(''));
    });
    await flush();
    expect(payloadOfType(clearBaseline, 'setText')).toEqual({text: ''});
  });

  it('T-HOST4: testID 落容器 View（WebView 为其子节点）', async () => {
    const tree = await render(
      <ComposerAtPathInput
        testID="chat-composer-input"
        value=""
        onChangeText={() => {}}
      />,
    );

    const matches = tree.root.findAllByProps({
      testID: 'chat-composer-input',
    });
    expect(matches.length).toBeGreaterThan(0);
    // 落点应是宿主渲染的容器 View（带高度样式、以 WebView 为子节点），
    // 不是只把 testID 透传下去的合成组件。
    const container = matches.find(node => {
      const flat = StyleSheet.flatten(node.props.style);
      return (
        flat != null &&
        typeof flat.height === 'number' &&
        node.findAllByType(webViewType() as React.ComponentType<unknown>)
          .length >= 1
      );
    });
    expect(container).toBeDefined();
    // 容器高度初值 = metrics.minHeight（chat 内联口径 56）
    expect(StyleSheet.flatten(container!.props.style).height).toBe(56);
  });

  it('T-HOST5: selection prop 受控变化 → setSelection；web 上报的同值视为自身回声不下发', async () => {
    const renderHost = (selection: ComposerInputSelection | null) => (
      <ComposerInputWebView
        mode="composer-token"
        value=""
        onChangeText={() => {}}
        metrics={CHAT_METRICS}
        selection={selection}
      />
    );
    const tree = await render(renderHost(null));

    simulateWebReady(tree.root);
    await flush();

    const baseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderHost({start: 2, end: 4}));
    });
    await flush();
    expect(payloadOfType(baseline, 'setSelection')).toEqual({
      start: 2,
      end: 4,
    });

    // 回声抑制：web 刚上报同一选区后父层回灌同值 → 不产生回环消息
    simulateWebMessage(tree.root, 'selectionChange', {start: 2, end: 4});
    const echoBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderHost({start: 2, end: 4}));
    });
    await flush();
    expect(
      typesSince(echoBaseline).filter(type => type === 'setSelection'),
    ).toEqual([]);
  });

  it('T-HOST6: editable/disabled 变化 → init.disabled（初始只读）+ setDisabled（运行态切换）', async () => {
    const renderShell = (editable: boolean) => (
      <ComposerAtPathInput
        value=""
        onChangeText={() => {}}
        editable={editable}
      />
    );
    const tree = await render(renderShell(false));

    simulateWebReady(tree.root);
    await flush();

    expect(payloadOfType(0, 'init')).toMatchObject({
      mode: 'composer-token',
      disabled: true,
      metrics: CHAT_METRICS,
    });

    // 只读解除（running 结束 / 末条恢复可编辑）→ setDisabled，不重发 init
    const enableBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell(true));
    });
    await flush();
    expect(payloadOfType(enableBaseline, 'setDisabled')).toEqual({
      disabled: false,
    });
    expect(typesSince(enableBaseline)).not.toContain('init');

    const disableBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell(false));
    });
    await flush();
    expect(payloadOfType(disableBaseline, 'setDisabled')).toEqual({
      disabled: true,
    });
  });

  it('T-HOST7（附加）: heightChange → 容器高度跟随并上抛 onHeight', async () => {
    const onHeight = jest.fn();
    const renderHost = (h: (height: number) => void) => (
      <ComposerInputWebView
        mode="composer-token"
        value=""
        onChangeText={() => {}}
        metrics={CHAT_METRICS}
        onHeight={h}
        testID="composer-host"
      />
    );
    const tree = await render(renderHost(onHeight));

    simulateWebReady(tree.root);
    await flush();

    simulateWebMessage(tree.root, 'heightChange', {height: 100});
    expect(onHeight).toHaveBeenCalledWith(100);

    // 带样式的那个节点才是容器 View（同名 testID 会同时命中合成组件）
    const container = tree.root
      .findAllByProps({testID: 'composer-host'})
      .find(node => node.props.style != null);
    expect(container).toBeDefined();
    expect(StyleSheet.flatten(container!.props.style).height).toBe(100);
  });

  it('T-HOST8（附加）: web 上报 change 只上抛、不回写 setText（打字真源防线）', async () => {
    const onChangeText = jest.fn();
    const tree = await render(
      <ComposerInputWebView
        mode="composer-token"
        value=""
        onChangeText={onChangeText}
        metrics={CHAT_METRICS}
      />,
    );

    simulateWebReady(tree.root);
    await flush();

    const baseline = mockWebViewPostMessages.length;
    simulateWebMessage(tree.root, 'change', {text: '你'});
    await flush();

    expect(onChangeText).toHaveBeenCalledWith('你');
    expect(typesSince(baseline)).not.toContain('setText');
  });
});
