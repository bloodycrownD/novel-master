/**
 * Agent in-flight 流式 partial registry port.
 *
 * 按 sessionId 索引当前正在进行的 run 的流式累积文本（text + thinking）。
 * 与 {@link AgentAbortRegistry} 并行——abort registry 管 controller，这里管
 * "到目前为止已经吐出的流式文本"。
 *
 * 存在意义：子会话流式输出期间，用户可能晚于 run 启动才进入子会话页面。
 * eventBus 是 fire-and-forget，mount 前的 delta 事件无法重放。有了这个
 * registry，UI 进入时可以直接查询已累积的全部 partial，不依赖订阅时机。
 *
 * 生命周期：run 开始时 {@link register}（签发新句柄、建立首步基线），
 * 每次 stream delta 时 {@link append}，单 step 的 assistant commit 后
 * {@link reset}（清空累积但保留句柄，让下一步从空开始），run 结束时
 * {@link unregister}（带句柄所有权比对，移除条目）。与 abortRegistry 的
 * register/unregister 时机对齐。
 *
 * @module service/agent/agent-stream-registry.port
 */

/** 单个 sessionId 对应的流式 partial 快照。 */
export interface AgentStreamPartial {
  /** 文本 delta 累积。 */
  readonly text: string;
  /** 思考链 delta 累积。 */
  readonly thinking: string;
}

/**
 * {@link register} 签发的所有权句柄。
 *
 * 由 {@link AgentStreamRegistry.register} 返回，反注册时回传，用于并发 run
 * 之间的所有权比对（同 {@link AgentAbortRegistry.unregister} 的 controller
 * 引用比对）。同一 run 内的 {@link reset} 不换句柄，所以 finally 的比对
 * 仍能识别 run 所有权。
 */
export type AgentStreamRegistryHandle = string;

/**
 * Agent run stream registry.
 *
 * 注册 / 追加 / 查询 / 反注册当前 in-flight run 的流式累积文本。
 * 所有方法对未注册的 sessionId 静默 no-op。
 */
export interface AgentStreamRegistry {
  /**
   * 注册某个 sessionId，初始化空 partial 并签发新的所有权句柄。
   *
   * 仅在 run 边界调用（run-agent-turn 入口 / runChildAgent 入口）。
   * 同一 sessionId 再次 register 会覆盖旧记录（旧 run 应已走完 finally），
   * 返回新的句柄——旧句柄随即失效。
   */
  register(sessionId: string): AgentStreamRegistryHandle;

  /**
   * 重置某个 sessionId 的累积文本（清空 text / thinking），但保留当前句柄。
   *
   * 用于单个 run 内每 step 的 assistant commit 之后，让下一步从空累积开始，
   * 避免用户在 step N≥2 重进子会话时拿到 step1+…+stepN 的拼接（前几步已
   * 落库文本被当成大 delta 重复推）。
   *
   * 与 {@link register} 的区别：register 换句柄（run 边界），reset 不换
   * （step 边界），这样 finally 的 {@link unregister} 句柄比对仍能正确
   * 识别 run 所有权。未注册的 sessionId 静默 no-op。
   */
  reset(sessionId: string): void;

  /**
   * 追加 delta：传 text / thinking 的增量，已存在的值会拼接保留。
   * 传空字符串等价于不修改对应字段。
   * 未注册的 sessionId 静默 no-op。
   */
  append(sessionId: string, delta: Partial<AgentStreamPartial>): void;

  /**
   * 查询某个 sessionId 的当前流式累积文本。
   * 未注册返回 undefined。
   */
  get(sessionId: string): AgentStreamPartial | undefined;

  /** 该 sessionId 当前是否注册了 in-flight partial。 */
  has(sessionId: string): boolean;

  /**
   * 反注册：移除某个 sessionId 的 partial（run 结束时调用）。
   *
   * 带所有权比对——传入 handle 与当前 map 里记录的 handle 一致才删。
   * 这样同一 sessionId 并发 run A/B 时，A 的 finally 晚于 B 的 register
   * 也不会误删 B 刚建立的 partial（与 {@link AgentAbortRegistry.unregister}
   * 的 controller 引用比对对称）。handle 省略时不比对直接删，兼容不关心
   * 所有权的调用方。
   */
  unregister(sessionId: string, handle?: AgentStreamRegistryHandle): void;
}
