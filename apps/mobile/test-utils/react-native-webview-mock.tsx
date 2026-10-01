/**
 * Jest stub for react-native-webview (ESM in node_modules; not transformed by default).
 *
 * ## 消息缓冲：全局聚合 + 按实例/域分流
 *
 * 原始形态只有一个模块级数组 `mockWebViewPostMessages`：同屏挂 N 个 WebView
 * 时（chat 域转录 + composer 两实例、vfs 里的 rich-document / code-editor、
 * 子会话屏），它们的下行全落进同一条缓冲，测试只能靠「按下标猜是哪台」或
 * 「恰好只挂一台」来定位——CR 在 chat-webview-unify 里点名的混流问题就是这个。
 *
 * 现在每个 mock 实例自带一条 `posts` 缓冲，并按**域**（从 `source.uri` 解析出的
 * 包名：`chat-conversation` / `chat-transcript` / `composer-input` /
 * `rich-document` / `code-editor`，无 uri 的内联 html 记作 `inline`）分组暴露：
 * - `getMockWebViewInstances(domain?)` / `getMockWebViewPosts(domain?)` 取实例或消息；
 * - `findMockWebViewByDomain(root, domain)` 在测试树里定位某个域的那台实例
 *   （驱动 `onMessage` 用，比「取第一个」稳）；
 * - `clearMockWebViewPosts(domain?)` 只清某域，或不传域全清。
 *
 * **兼容性纪律**：`mockWebViewPostMessages` 与 `clearMockWebViewPostMessages()`
 * 保留原语义（跨全部实例的聚合序），存量用例一行不用改；新用例请优先用域口径。
 */
import React from 'react';
import {View, type ViewProps} from 'react-native';
import type {ReactTestInstance, ReactTestRenderer} from 'react-test-renderer';

export type WebViewMessageEvent = {
  nativeEvent: {data: string};
};

type WebViewProps = ViewProps & {
  onMessage?: (event: WebViewMessageEvent) => void;
  source?: {html?: string; uri?: string; baseUrl?: string};
};

/**
 * 域标识：正常情况是包名（`chat-conversation` 等），退化情形为
 * `'inline'`（内联 html）/ `'unknown'`（既无 uri 也无 html）。
 */
export type MockWebViewDomain = string;

export type MockWebViewInstance = {
  readonly id: number;
  readonly domain: MockWebViewDomain;
  /** 该实例自己的下行消息（`postMessage` 原样字符串，按时间序）。 */
  readonly posts: string[];
};

/** Captured postMessage payloads across all instances (cleared via clearMockWebViewPostMessages). */
export const mockWebViewPostMessages: string[] = [];

/** 当前已挂载的 mock 实例（按挂载序；卸载即摘除，避免旧树跨用例污染）。 */
const instances: MockWebViewInstance[] = [];
let nextInstanceId = 1;

/** 从 `source` 解析域：uri 里的包名优先，其次内联 html，最后 unknown。 */
function resolveDomain(source: WebViewProps['source']): MockWebViewDomain {
  const uri = source?.uri;
  if (typeof uri === 'string') {
    const match = uri.match(/\/(?:webview|WebViewDist)\/([^/]+)\//);
    if (match != null) {
      return match[1]!;
    }
    return 'unknown';
  }
  return source?.html != null ? 'inline' : 'unknown';
}

/** 取已挂载实例；传 domain 则只取该域（保持挂载序）。 */
export function getMockWebViewInstances(
  domain?: MockWebViewDomain,
): MockWebViewInstance[] {
  return domain == null
    ? instances.slice()
    : instances.filter(item => item.domain === domain);
}

/** 取消息；传 domain 则只取该域实例的消息（保持实例序 + 实例内时间序）。 */
export function getMockWebViewPosts(domain?: MockWebViewDomain): string[] {
  return getMockWebViewInstances(domain).flatMap(item => item.posts);
}

/** 清消息：传 domain 则只清该域；不传则连同聚合缓冲一起全清。 */
export function clearMockWebViewPosts(domain?: MockWebViewDomain): void {
  for (const item of getMockWebViewInstances(domain)) {
    item.posts.length = 0;
  }
  if (domain == null) {
    mockWebViewPostMessages.length = 0;
  }
}

/** 全清（保留原名，全量用例仍在用）。 */
export function clearMockWebViewPostMessages(): void {
  clearMockWebViewPosts();
}

/**
 * 在测试树里定位某个域的那台 WebView mock（驱动 `onMessage` 用）。
 * 同域多台时取**挂载序第一台**——与「取第一个 WebView」的旧写法在单实例场景等价，
 * 但在同屏多 WebView 场景下不会误取到别的域。
 */
export function findMockWebViewByDomain(
  root: ReactTestInstance | ReactTestRenderer['root'],
  domain: MockWebViewDomain,
): ReactTestInstance {
  const node = root
    .findAllByType(WebViewMock as unknown as React.ComponentType<unknown>)
    .find(item => {
      const uri = (item.props as WebViewProps).source?.uri;
      return uri != null && resolveDomain({uri}) === domain;
    });
  if (node == null) {
    throw new Error(`WebView mock 未找到域「${domain}」的实例`);
  }
  return node;
}

const WebViewMock = React.forwardRef<
  {postMessage: (data: string) => void},
  WebViewProps
>(function WebViewMock(props, ref) {
  const instanceRef = React.useRef<MockWebViewInstance | null>(null);
  if (instanceRef.current == null) {
    instanceRef.current = {
      id: nextInstanceId++,
      domain: resolveDomain(props.source),
      posts: [],
    };
  }
  const instance = instanceRef.current;

  React.useEffect(() => {
    instances.push(instance);
    return () => {
      const index = instances.indexOf(instance);
      if (index >= 0) {
        instances.splice(index, 1);
      }
    };
  }, [instance]);

  const postMessage = React.useCallback(
    (data: string) => {
      instance.posts.push(data);
      mockWebViewPostMessages.push(data);
    },
    [instance],
  );
  React.useImperativeHandle(ref, () => ({postMessage}), [postMessage]);
  return <View ref={ref as React.Ref<View>} {...props} />;
});

export default WebViewMock;
