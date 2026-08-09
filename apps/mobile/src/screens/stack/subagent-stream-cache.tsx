/**
 * 子会话流式 partial 缓存（mobile）。
 *
 * 背景：mobile 的 SubagentSessionScreen 是 native-stack 的 push/pop 页面，pop
 * 时整个组件 unmount，state + WebView 全销毁。主会话（ChatTabScreen）是
 * tab 常驻页可以靠 keep-alive 之类的办法保住 partial，子会话这条路走不通。
 *
 * 这里用一个挂在 RootNavigator 顶层的 React Context 维护「按 sessionId 分桶
 * 的 streamingText / streamingThinking」缓存。screen 活跃时把 delta 累加进去，
 * unmount 后缓存仍在；remount 时从缓存里把 partial 注入回新的 WebView。
 *
 * 只缓存字符串本身，不缓存 runId、metrics 之类的状态——delta 事件是无状态
 * 不可重放的，重进后真正的请求还在跑（abortRegistry 里有记录），把已经吐出
 * 的部分文本补回去就够了，后续 delta 会继续正常推送。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/** 单个 sessionId 对应的流式 partial。 */
export type SubagentStreamPartial = {
  /** 文本 delta 累积。 */
  readonly text: string;
  /** 思考链 delta 累积。 */
  readonly thinking: string;
};

type SubagentStreamCacheValue = {
  /** 取某个 sessionId 的缓存 partial；不存在返回 undefined。 */
  get(sessionId: string): SubagentStreamPartial | undefined;
  /**
   * 累加 partial：传 text / thinking 的增量 delta，已存在的值会拼接保留。
   * 传空字符串等价于不修改对应字段。
   */
  set(sessionId: string, partial: Partial<SubagentStreamPartial>): void;
  /** 用全量覆盖某个 sessionId 的缓存（remount 恢复时用）。 */
  replace(sessionId: string, partial: SubagentStreamPartial): void;
  /** 清掉某个 sessionId 的缓存（run 结束、commit 落库后调用）。 */
  clear(sessionId: string): void;
};

const SubagentStreamCacheContext = createContext<SubagentStreamCacheValue | null>(
  null,
);

/**
 * Provider 包在 RootNavigator 顶层（Stack.Navigator 外层），让所有
 * SubagentSessionView push/pop 共享同一份缓存 Map。
 */
export function SubagentStreamCacheProvider({
  children,
}: {
  children: ReactNode;
}) {
  // 用 ref 持 Map：不触发重渲染，订阅 effect 直接 mutate；remount 时
  // useSubagentStreamCache().get() 在 useMemo 里读取即可拿到最新值。
  const mapRef = useRef<Map<string, SubagentStreamPartial>>(new Map());

  const get = useCallback((sessionId: string) => {
    return mapRef.current.get(sessionId);
  }, []);

  const set = useCallback(
    (sessionId: string, partial: Partial<SubagentStreamPartial>) => {
      const current = mapRef.current.get(sessionId) ?? {
        text: '',
        thinking: '',
      };
      const text =
        partial.text != null ? current.text + partial.text : current.text;
      const thinking =
        partial.thinking != null
          ? current.thinking + partial.thinking
          : current.thinking;
      mapRef.current.set(sessionId, {text, thinking});
    },
    [],
  );

  const replace = useCallback(
    (sessionId: string, partial: SubagentStreamPartial) => {
      mapRef.current.set(sessionId, {
        text: partial.text,
        thinking: partial.thinking,
      });
    },
    [],
  );

  const clear = useCallback((sessionId: string) => {
    mapRef.current.delete(sessionId);
  }, []);

  const value = useMemo<SubagentStreamCacheValue>(
    () => ({get, set, replace, clear}),
    [get, set, replace, clear],
  );

  return (
    <SubagentStreamCacheContext.Provider value={value}>
      {children}
    </SubagentStreamCacheContext.Provider>
  );
}

/**
 * 取子会话流式缓存。必须在 {@link SubagentStreamCacheProvider} 内调用，
 * 否则抛错——避免静默吞掉缓存逻辑。
 */
export function useSubagentStreamCache(): SubagentStreamCacheValue {
  const ctx = useContext(SubagentStreamCacheContext);
  if (ctx == null) {
    throw new Error(
      'useSubagentStreamCache 必须在 SubagentStreamCacheProvider 内使用',
    );
  }
  return ctx;
}
