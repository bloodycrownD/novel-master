/**
 * T-L3：rows-click `<a>` 链接拦截分支行为测试（chat-link-file-nav）。
 *
 * Jest 为 RN 环境（无 jsdom），但 onRowsClick 只消费 target.closest /
 * getAttribute / event.preventDefault 三个 DOM 接口，模块导入链顶层无
 * document 访问——以最小 fake 元素 + fake 事件直接真实执行函数（行为级），
 * 上抛通道经 window.ReactNativeWebView.postMessage（@web/shared/post 出口）
 * 捕获断言。
 */
import {onRowsClick} from '../src/web/chat-transcript/webview/runtime/render/rows-click';

type FakeElement = {
  tagName: string;
  attrs: Record<string, string>;
  closest: (selector: string) => FakeElement | null;
  getAttribute: (name: string) => string | null;
};

/** 构造带祖先链的最小元素：ancestors 按由近到远排（closest 逐层匹配）。 */
function makeEl(
  tagName: string,
  attrs: Record<string, string> = {},
  ancestors: FakeElement[] = [],
): FakeElement {
  const el: FakeElement = {
    tagName,
    attrs,
    closest(selector: string) {
      const chain = [el, ...ancestors];
      for (const node of chain) {
        if (selector === '[data-action]' && node.attrs['data-action'] != null) {
          return node;
        }
        if (selector === 'a' && node.tagName === 'a') {
          return node;
        }
      }
      return null;
    },
    getAttribute(name: string) {
      return el.attrs[name] ?? null;
    },
  };
  return el;
}

function makeClickEvent(target: FakeElement): {target: FakeElement; preventDefault: jest.Mock} {
  return {target, preventDefault: jest.fn()};
}

function makeEvent(target: FakeElement) {
  return makeClickEvent(target) as unknown as MouseEvent;
}

/** 捕获 postMessage 上抛（@web/shared/post 出口为 window.ReactNativeWebView）。 */
function postedEnvelopes(): Array<{v: number; type: string; payload: unknown}> {
  const bridge = (window as unknown as {
    ReactNativeWebView?: {postMessage: (msg: string) => void};
  }).ReactNativeWebView;
  return bridge
    ? (bridge.postMessage as unknown as jest.Mock).mock.calls.map(call =>
        JSON.parse(call[0] as string),
      )
    : [];
}

describe('rows-click <a> 拦截分支 (T-L3)', () => {
  let postMessage: jest.Mock;

  beforeEach(() => {
    postMessage = jest.fn();
    (window as unknown as {ReactNativeWebView?: unknown}).ReactNativeWebView =
      {postMessage};
  });

  afterEach(() => {
    delete (window as unknown as {ReactNativeWebView?: unknown})
      .ReactNativeWebView;
  });

  it('文件链接 <a href="x.md">：preventDefault + 上抛 linkClick 原始 href', () => {
    const anchor = makeEl('a', {href: 'x.md'});
    const inner = makeEl('span', {}, [anchor]);
    const event = makeEvent(inner);
    onRowsClick(event);
    expect(
      (event as unknown as {preventDefault: jest.Mock}).preventDefault,
    ).toHaveBeenCalledTimes(1);
    expect(postedEnvelopes()).toEqual([
      {v: 1, type: 'linkClick', payload: {href: 'x.md'}},
    ]);
  });

  it('纯锚点 <a href="#foo">：不拦（放行 webview 默认滚动）、不上抛', () => {
    const anchor = makeEl('a', {href: '#foo'});
    const event = makeEvent(anchor);
    onRowsClick(event);
    expect(
      (event as unknown as {preventDefault: jest.Mock}).preventDefault,
    ).not.toHaveBeenCalled();
    expect(postedEnvelopes()).toEqual([]);
  });

  it('中文路径与 URL 编码 href 原样上抛（识别归宿主侧，不在 webview 解码）', () => {
    const encoded = makeEl('a', {href: '%E7%AC%94%E8%AE%B0/a.md'});
    onRowsClick(makeEvent(encoded));
    const plain = makeEl('a', {href: '笔记/大纲.md'});
    onRowsClick(makeEvent(plain));
    expect(postedEnvelopes()).toEqual([
      {v: 1, type: 'linkClick', payload: {href: '%E7%AC%94%E8%AE%B0/a.md'}},
      {v: 1, type: 'linkClick', payload: {href: '笔记/大纲.md'}},
    ]);
  });

  it('data-action 元素点击不受 <a> 分支影响（open-tool-file 原路径不变）', () => {
    // data-action 卡片外套一层 <a>（极端嵌套）：data-action 命中优先，不落链接分支
    const actionEl = makeEl('div', {
      'data-action': 'open-tool-file',
      'data-path': '/续写/chapter.md',
    });
    const wrappedInAnchor = makeEl('span', {}, [actionEl, makeEl('a', {href: 'x.md'})]);
    const event = makeEvent(wrappedInAnchor);
    onRowsClick(event);
    expect(
      (event as unknown as {preventDefault: jest.Mock}).preventDefault,
    ).not.toHaveBeenCalled();
    expect(postedEnvelopes()).toEqual([
      {v: 1, type: 'openToolFile', payload: {path: '/续写/chapter.md'}},
    ]);
  });

  it('无 href 的 <a>：不拦不上抛（无目标可路由）', () => {
    const anchor = makeEl('a');
    const event = makeEvent(anchor);
    onRowsClick(event);
    expect(
      (event as unknown as {preventDefault: jest.Mock}).preventDefault,
    ).not.toHaveBeenCalled();
    expect(postedEnvelopes()).toEqual([]);
  });

  it('非链接非 data-action 的普通点击：无动作', () => {
    const plain = makeEl('div');
    const event = makeEvent(plain);
    onRowsClick(event);
    expect(
      (event as unknown as {preventDefault: jest.Mock}).preventDefault,
    ).not.toHaveBeenCalled();
    expect(postedEnvelopes()).toEqual([]);
  });
});
