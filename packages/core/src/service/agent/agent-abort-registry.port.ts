/**
 * Agent abort registry port.
 *
 * 按 sessionId 索引每个 in-flight run 的 `AbortController`，给外部
 * （mobile / desktop 停止按钮、IPC 等）一个统一的「按 sessionId 中断」入口。
 *
 * 与 caller signal / parentSignal 级联是两条不重叠的路：
 * - registry 只负责「按 sessionId 找 controller 并 .abort()」；
 * - parentSignal 级联（`addEventListener("abort", ...)`）继续负责
 *   父 → 子 controller 的同步中断。
 *
 * @module service/agent/agent-abort-registry.port
 */

/**
 * Agent run abort registry.
 *
 * 注册 / 反注册 / 中断当前 in-flight run 的 `AbortController`。
 * 所有方法对未注册的 sessionId 静默 no-op。
 */
export interface AgentAbortRegistry {
  /**
   * 注册某个 sessionId 当前 run 的 controller。
   *
   * 同一 sessionId 再次 register 会覆盖前一条记录——这是预期行为，
   * 因为旧 run 应该已经走完 finally 的 unregister 了。覆盖时由
   * {@link unregister} 的所有权比对兜底（误删新 run 的 controller）。
   */
  register(sessionId: string, controller: AbortController): void;

  /**
   * 原子 claim：仅在该 sessionId **尚未注册**时登记 controller 并返回 `true`；
   * 已注册则**不覆盖**既有 controller、直接返回 `false`。
   *
   * 与 {@link register} 是并行的两套语义，不要混用：
   * - `register` = 无条件覆盖（见上），适合「自己就是当前 run 的权威方」；
   * - `tryRegister` = 抢占式占用，适合「多个并发 run 竞争同一 sessionId、
   *   只能有一个赢家」的场景（如 task 工具续用子会话时的并发硬互斥）。
   *
   * 判重与写入在同一个同步段内完成（无 await），因此同 step 内并发的两个
   * claim 一定一成一败；败方不得留下任何副作用（典型：不要在 claim 之前
   * 往子会话 append user 消息）。赢家用 finally 的 {@link unregister}
   * 释放（所有权比对保证不误删他人 controller）。
   */
  tryRegister(sessionId: string, controller: AbortController): boolean;

  /**
   * 中断指定 sessionId 的当前 run。
   *
   * 拿到 controller 调 `.abort()` 后**不删**记录——删除由 finally 的
   * {@link unregister} 完成，避免 abort 与反注册的时序竞态下误判 has()。
   * 未注册的 sessionId 静默 no-op。
   */
  abort(sessionId: string): void;

  /**
   * 反注册：带所有权比对，只有当前 map 里存的 controller 与传入的
   * controller 是**同一引用**时才删除。
   *
   * 这样如果新 run 已经覆盖了旧记录，旧 run 的 finally 不会误删新 run
   * 的 controller——`map.get(sessionId) === controller` 不成立就跳过。
   */
  unregister(sessionId: string, controller: AbortController): void;

  /** 该 sessionId 当前是否注册了 in-flight controller。 */
  has(sessionId: string): boolean;
}
