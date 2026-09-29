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
import {Linking, Platform, StyleSheet} from 'react-native';
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
  getComposerInputPackageDirUri,
  getComposerInputUri,
} from '@/webview-host/composer-input/uri';
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

/** chat 壳（ComposerAtPathInput）的默认 metrics 组装口径（5 行封顶：12 + 22×5）。 */
const CHAT_METRICS: ComposerInputMetrics = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 122,
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

  it('T-HOST7（附加）: heightChange → 容器高度跟随（视觉高度走真值，非 state 直读）', async () => {
    // 容器高度所有权在本宿主（onHeight 零消费方已删），断言面是 Animated.View 的
    // style.height。这条断言的牙齿来自 reanimated mock 的 useSharedValue「只初始化」
    // 语义：若实现里删掉 `heightAV.value = withTiming(...)` 整行，shared value 停在
    // 初值 minHeight，style.height 不再跟随 → 本例红。
    const renderHost = () => (
      <ComposerInputWebView
        mode="composer-token"
        value=""
        onChangeText={() => {}}
        metrics={CHAT_METRICS}
        testID="composer-host"
      />
    );
    const tree = await render(renderHost());

    simulateWebReady(tree.root);
    await flush();

    // 带样式的那个节点才是容器 View（同名 testID 会同时命中合成组件）
    const container = () =>
      tree.root
        .findAllByProps({testID: 'composer-host'})
        .find(node => node.props.style != null);
    expect(container()).toBeDefined();
    expect(StyleSheet.flatten(container()!.props.style).height).toBe(56);

    simulateWebMessage(tree.root, 'heightChange', {height: 100});
    await flush();
    expect(StyleSheet.flatten(container()!.props.style).height).toBe(100);

    // 第二个台阶走缓动路径（首个上报已过 hasReportedHeightRef）
    simulateWebMessage(tree.root, 'heightChange', {height: 122});
    await flush();
    expect(StyleSheet.flatten(container()!.props.style).height).toBe(122);
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

  it('T-HOST9: 外部 value 写入作废选区基线——壳随后的 setSelection 必放行一次', async () => {
    // host/B-1 协议用例：全屏回填这类「外部 value 变化」走 setText，web 侧光标被
    // 推到文末，宿主 lastSelectionRef 基线随之作废。若壳随后的 setSelection 恰与
    // 作废前的旧基线同值，必须仍然放行——否则光标永久停在文末
    // （违反「按 clamp(旧 cursor, 新长度) 落位」口径）。
    //
    // 构造：先让 web 上报 {3,3} 建立基线，再用**外部 value 变化**把 value 改长
    // （光标期望仍是 3 —— 正是全屏回填场景），断言 setSelection 下发了 {3,3}。
    // 去掉 setText effect 里的 `lastSelectionRef.current = null` 即红。
    const renderHost = (value: string, selection: ComposerInputSelection) => (
      <ComposerInputWebView
        mode="composer-token"
        value={value}
        onChangeText={() => {}}
        metrics={CHAT_METRICS}
        selection={selection}
      />
    );
    const tree = await render(renderHost('', {start: 3, end: 3}));

    simulateWebReady(tree.root);
    await flush();

    // web 侧先把光标放到 3，宿主基线 = {3,3}（此时 selection prop 同值被回声抑制）
    const echoBaseline = mockWebViewPostMessages.length;
    simulateWebMessage(tree.root, 'selectionChange', {start: 3, end: 3});
    await flush();
    expect(typesSince(echoBaseline)).not.toContain('setSelection');

    // 外部回填：value 从 '' 变长文本，壳的选区期望仍是 {3,3}（clamp 旧 cursor）
    const refillBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderHost('回填后的长文本', {start: 3, end: 3}));
    });
    await flush();

    expect(payloadOfType(refillBaseline, 'setText')).toEqual({
      text: '回填后的长文本',
    });
    // 关键断言：与作废前基线同值，仍必须放行一次。
    expect(payloadOfType(refillBaseline, 'setSelection')).toEqual({
      start: 3,
      end: 3,
    });
  });

  it('T-HOST10（G-2a）: webReady 门控——未收到 ready 时零下行消息', async () => {
    await render(
      <ComposerInputWebView
        mode="composer-token"
        value="初始文本"
        onChangeText={() => {}}
        metrics={CHAT_METRICS}
        selection={{start: 1, end: 1}}
      />,
    );

    // 不 simulateWebReady：init / setText / setSelection / themeUpdate 一条都不许发
    await flush();
    expect(mockWebViewPostMessages).toEqual([]);
  });

  it('T-HOST11（G-2b）: theme 换新对象同内容重渲 → themeUpdate 恰一条（打 JSON.stringify 比对线）', async () => {
    const themeA = {
      background: '#000',
      text: '#fff',
      textSecondary: '#ccc',
      primary: '#08f',
      primaryMuted: '#08f22',
      selection: '#08f55',
    };
    // 逐字段同值、引用不同的新对象
    const themeASame = {...themeA};
    const renderHost = (theme: typeof themeA) => (
      <ComposerInputWebView
        mode="composer-token"
        value=""
        onChangeText={() => {}}
        metrics={CHAT_METRICS}
        theme={theme}
      />
    );
    const tree = await render(renderHost(themeA));

    simulateWebReady(tree.root);
    await flush();
    expect(payloadOfType(0, 'init')).toMatchObject({theme: themeA});

    // 同内容新对象 → 不重发（init 已含该值）
    const sameBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderHost(themeASame));
    });
    await flush();
    expect(typesSince(sameBaseline)).not.toContain('themeUpdate');

    // 内容真变 → 恰一条 themeUpdate
    const changedBaseline = mockWebViewPostMessages.length;
    const themeB = {...themeA, primary: '#f80', primaryMuted: '#f8022'};
    await act(async () => {
      tree.update(renderHost(themeB));
    });
    await flush();
    expect(
      typesSince(changedBaseline).filter(type => type === 'themeUpdate'),
    ).toHaveLength(1);
    expect(payloadOfType(changedBaseline, 'themeUpdate')).toEqual({
      theme: themeB,
    });
  });

  it('T-HOST12（G-2c）: editable 同值重渲 → 零 setDisabled', async () => {
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
    // 初始只读走 init.disabled，不发 setDisabled
    expect(typesSince(0)).not.toContain('setDisabled');

    // 同值重渲 → 一条都不许发
    const sameBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell(false));
    });
    await flush();
    expect(typesSince(sameBaseline)).not.toContain('setDisabled');
  });

  it('T-HOST13（G-3）: 导航守卫——包目录放行、http 外跳系统浏览器、其余 scheme 拒绝', async () => {
    // 外部页面无法在 WebView 内落地，其伪造桥消息即无从成立（sec/D-1）。
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = await render(
      <ComposerInputWebView
        mode="composer-token"
        value=""
        onChangeText={() => {}}
        metrics={CHAT_METRICS}
      />,
    );
    const guard = findWebView(tree.root).props
      .onShouldStartLoadWithRequest as (req: {url: string}) => boolean;
    expect(typeof guard).toBe('function');

    // ① 包目录内的 index.html（同包相对资源同理）→ 放行
    expect(guard({url: getComposerInputUri()})).toBe(true);
    expect(guard({url: `${getComposerInputPackageDirUri()}app.js`})).toBe(true);
    expect(openUrl).not.toHaveBeenCalled();

    // ② http/https 外跳系统浏览器、拒绝页内导航
    expect(guard({url: 'https://example.com/x'})).toBe(false);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/x');

    // ③ 其余 scheme 一律拒绝，且不外跳
    openUrl.mockClear();
    expect(guard({url: 'content://evil'})).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();

    // ④ 包目录前缀被删（或守卫改 return true）时，② ③ 两组必红
    expect(guard({url: 'file:///somewhere/else/index.html'})).toBe(false);
    openUrl.mockRestore();
  });
});
