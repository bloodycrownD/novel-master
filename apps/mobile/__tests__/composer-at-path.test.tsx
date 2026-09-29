/**
 * T-ATD2/3/4 / T-AT3 / T-SC1 + v1.5.9 回归（壳桥协议版）：
 * Mobile `@路径` token 口径、无 attach chip、选中色载荷、打字不回写。
 *
 * WebView 化后本文件的两块断言面变了：core 纯函数用例（token 生成 / 扫描 /
 * 候选过滤 / 活动查询）原样保留；组件层不再断言 TextInput children / mention
 * span / markup 对账（main 版 mention 库全链已随单引擎 WebView 消失），
 * 改断言宿主桥消息（mock WebView 范式照 `composer-input-webview.test.tsx`）。
 * 原子删行为在 web 侧（`atomic-range-delete` 纯函数套件 T-AD*）另有覆盖。
 */
import {describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  partitionComposerChipAttachments,
  scanAtPathAttachments,
} from '@novel-master/core/chat';
import {
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
} from '@/components/chat/composer-at-path';
import {
  ComposerAtPathInput,
  type ComposerAtPathInputHandle,
} from '@/components/chat/ComposerAtPathInput';
import {
  COMPOSER_INPUT_BRIDGE_VERSION,
  decodeHostToComposerInput,
  type HostToComposerInputMessage,
} from '@/components/chat/ComposerInputBridge';
import {darkTheme, lightTheme} from '@/theme/tokens';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';

jest.mock('@/theme/ThemeProvider', () => {
  const {lightTheme: theme} =
    require('@/theme/tokens') as typeof import('@/theme/tokens');
  return {
    useTheme: () => ({
      mode: 'light' as const,
      tokens: theme,
      loaded: true,
      setMode: async () => undefined,
      toggleMode: async () => undefined,
    }),
  };
});

/** 找 composer 宿主 WebView（与本包 URI 判据，勿用位置判据）。 */
function findComposerWebView(
  root: TestRenderer.ReactTestInstance,
): TestRenderer.ReactTestInstance {
  const WebViewMock = require('react-native-webview')
    .default as React.ComponentType<unknown>;
  const node = root
    .findAllByType(WebViewMock)
    .find(instance =>
      String(instance.props?.source?.uri ?? '').includes('composer-input'),
    );
  if (node == null) {
    throw new Error('composer WebView 未挂载');
  }
  return node;
}

/** 模拟 web → host 上报（信封 v 取本包 BRIDGE_V）。 */
function simulateWebMessage(
  root: TestRenderer.ReactTestInstance,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  const webView = findComposerWebView(root);
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

function hostMessagesFrom(clearAfterIndex: number): HostToComposerInputMessage[] {
  return mockWebViewPostMessages
    .slice(clearAfterIndex)
    .map(raw => decodeHostToComposerInput(raw));
}

function hostTypesSince(clearAfterIndex: number): string[] {
  return hostMessagesFrom(clearAfterIndex).map(message => message.type);
}

function hostPayloadOfType(clearAfterIndex: number, type: string): unknown {
  const found = hostMessagesFrom(clearAfterIndex).find(
    message => message.type === type,
  );
  return found == null ? null : found.payload;
}

/** 冲净 effect 与异步批（real timers）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

describe('composer-at-path (T-ATD* / T-AT* / T-SC1)', () => {
  it('T-ATD2: Picker token 为 @path；目录尾 /；扫描落库带前导 /', () => {
    const tokens = atPathTokensFromPickerSelection(['/notes'], ['/a.md']);
    expect(tokens).toEqual(['@/notes/', '@/a.md']);
    const scanned = scanAtPathAttachments(tokens.join(' '));
    expect(scanned).toHaveLength(2);
    expect(scanned[0]!.path).toBe('/notes/');
    expect(scanned[0]!.type).toBe('dir');
    expect(scanned[1]!.path).toBe('/a.md');
    expect(scanned.every(a => a.path!.startsWith('/'))).toBe(true);
  });

  it('T-ATD3: 手输 @ 搜索 ≤5，点选插入完整 @path', () => {
    const refs = [
      {path: '/a.md', kind: 'file' as const},
      {path: '/ab.md', kind: 'file' as const},
      {path: '/abc.md', kind: 'file' as const},
      {path: '/abcd.md', kind: 'file' as const},
      {path: '/abcde.md', kind: 'file' as const},
      {path: '/abcdef.md', kind: 'file' as const},
    ];
    expect(filterAtPathTypeaheadCandidates(refs, 'a', 5)).toHaveLength(5);

    const active = findActiveAtQuery('见 @ab', 5);
    expect(active).not.toBeNull();
    expect(active!.query).toBe('ab');
    const token = formatComposerAtPathToken('/ab.md', false);
    const next = replaceActiveAtWithToken('见 @ab', 5, active!.start, token);
    expect(next.text).toBe('见 @/ab.md ');
  });

  it('findActiveAtQuery: @/a.md 无尾空格为活跃；带尾空格则关闭', () => {
    const bare = '@/a.md';
    expect(findActiveAtQuery(bare, bare.length)).not.toBeNull();
    expect(findActiveAtQuery(bare, bare.length)!.query).toBe('/a.md');
    expect(findActiveAtQuery(`${bare} `, `${bare} `.length)).toBeNull();
  });

  it('T-ATD4: 删除正文 @path 后扫描为空', () => {
    expect(countScannedAtPathAttachments('看 @/a.md')).toBe(1);
    expect(countScannedAtPathAttachments('看')).toBe(0);
  });

  it('T-AT3: 仅 @path 扫描为 source:attach，不进状态 chip', () => {
    const scanned = scanAtPathAttachments('请看 @/a.md');
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.every(a => a.source === 'attach')).toBe(true);
    const {status, attach} = partitionComposerChipAttachments(scanned);
    expect(status).toHaveLength(0);
    expect(attach).toHaveLength(scanned.length);
  });

  it('T-SC1: 宿主 init.theme 载荷带 tokens.selection（≠ primary 原色）', async () => {
    expect(lightTheme.selection).not.toBe(lightTheme.primary);
    expect(darkTheme.selection).not.toBe(darkTheme.primary);
    expect(lightTheme.selection.startsWith(lightTheme.primary)).toBe(true);
    expect(darkTheme.selection.startsWith(darkTheme.primary)).toBe(true);

    // 选中色从 TextInput.selectionColor 改为 web 主题（::selection）驱动：
    // 断言面落在宿主 init.theme 载荷。
    clearMockWebViewPostMessages();
    const onChangeText = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ComposerAtPathInput value="" onChangeText={onChangeText} />,
      );
    });
    simulateWebReady(tree.root);
    await flush();

    const init = hostPayloadOfType(0, 'init') as {
      theme: {selection: string; primary: string; primaryMuted: string};
    };
    expect(init.theme.selection).toBe(lightTheme.selection);
    expect(init.theme.selection).not.toBe(lightTheme.primary);
    expect(init.theme.primaryMuted).toBe(`${lightTheme.primary}22`);
    // 默认非全程受控：无 pending 选区时不下发 setSelection。
    expect(hostTypesSince(0)).not.toContain('setSelection');
    await act(async () => {
      tree.unmount();
    });
  });

  it('带 token 打字不丢 token——web 上报 plain 原样落地、宿主不回写（v1.5.9 回归）', async () => {
    // 场景：草稿水化出带 @path 的文本 → web 侧续打上报 plain + 新字。
    // 旧实现（mention 库对账）拿 markup 与 plain 比较恒不等 → tag 一打字必死；
    // 单引擎后高亮只在 web 内按 token 分段，RN 侧 value 恒等于上报文本。
    clearMockWebViewPostMessages();
    const onChangeText = jest.fn();
    const renderShell = (value: string) => (
      <ComposerAtPathInput value={value} onChangeText={onChangeText} />
    );
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(renderShell(''));
    });
    const root = tree.root;
    simulateWebReady(root);
    await flush();

    const plain0 = '看 @/chapters/01.md 这段';
    const hydrateBaseline = mockWebViewPostMessages.length;
    await act(async () => {
      tree.update(renderShell(plain0));
    });
    await flush();
    // 水化：外部 value 变化 → setText 全量写入（web 侧自行按 token 高亮）。
    expect(hostPayloadOfType(hydrateBaseline, 'setText')).toEqual({
      text: plain0,
    });
    expect(plain0.includes('{@}')).toBe(false);

    // web 上报：plain + 一个中文字（web 自持真源）。
    const changeBaseline = mockWebViewPostMessages.length;
    simulateWebMessage(root, 'change', {text: `${plain0}字`});
    await flush();
    expect(onChangeText).toHaveBeenCalledWith(`${plain0}字`);
    // 打字不回写：change 之后无 setText（回写会打断 IME 组合态）。
    expect(hostTypesSince(changeBaseline)).not.toContain('setText');
    await act(async () => {
      tree.unmount();
    });
  });

  it('打字回流（父层 value 回声）不被当成外部写入：不下发 setSelection，光标不被拽回', async () => {
    // 真机实报症状：键盘输入时光标偶尔往回跳一两个字。
    // 病根：web 上报的文本经父层写回 value 时，壳里没推进差分基线 → 被当成「外部
    // 写入」→ 按上一拍的 cursor 强制摆一次选区，setSelectionRange 打在正在输入
    // （尤其 IME 组合态）的 textarea 上就把光标拽回去。
    clearMockWebViewPostMessages();
    // 父层回声 + 故意把 cursor 留旧值（模拟 RN 状态滞后一拍）。
    function Harness() {
      const [text, setText] = React.useState('');
      return (
        <ComposerAtPathInput
          value={text}
          cursor={0}
          onChangeText={next => setText(next)}
        />
      );
    }
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Harness />);
    });
    const root = tree.root;
    simulateWebReady(root);
    await flush();

    const typingBaseline = mockWebViewPostMessages.length;
    simulateWebMessage(root, 'change', {text: '终于'});
    await flush();
    simulateWebMessage(root, 'change', {text: '终于写'});
    await flush();

    // 回声不算外部写入：全程零 setSelection（有它会打断 IME 组合态并拽光标）。
    expect(hostTypesSince(typingBaseline)).not.toContain('setSelection');
    expect(hostTypesSince(typingBaseline)).not.toContain('setText');
    await act(async () => {
      tree.unmount();
    });
  });

  it('5 行封顶：默认 metrics 的 maxHeight = paddingV×2 + lineHeight×5（不再吃老 160）', async () => {
    clearMockWebViewPostMessages();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ComposerAtPathInput value="" onChangeText={jest.fn()} />,
      );
    });
    simulateWebReady(tree.root);
    await flush();

    const init = hostPayloadOfType(0, 'init') as {
      metrics: {lineHeight: number; paddingV: number; maxHeight: number};
    };
    expect(init.metrics.maxHeight).toBe(
      init.metrics.paddingV * 2 + init.metrics.lineHeight * 5,
    );
    await act(async () => {
      tree.unmount();
    });
  });

  it('程序化 replaceCommittedText → setText{text, selection}，对外 plain 无 {@}', async () => {
    clearMockWebViewPostMessages();
    const handleRef = React.createRef<ComposerAtPathInputHandle>();
    let text = '';
    const onChangeText = jest.fn((next: string) => {
      text = next;
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ComposerAtPathInput
          ref={handleRef}
          value={text}
          onChangeText={onChangeText}
        />,
      );
    });
    simulateWebReady(tree.root);
    await flush();

    const baseline = mockWebViewPostMessages.length;
    act(() => {
      handleRef.current?.replaceCommittedText('见 @/a.md ', 9);
    });
    await flush();

    expect(hostPayloadOfType(baseline, 'setText')).toEqual({
      text: '见 @/a.md ',
      selectionStart: 9,
      selectionEnd: 9,
    });
    expect(onChangeText).toHaveBeenCalledWith('见 @/a.md ');
    expect(text).toBe('见 @/a.md ');
    expect(text.includes('{@}')).toBe(false);
    await act(async () => {
      tree.unmount();
    });
  });
});
