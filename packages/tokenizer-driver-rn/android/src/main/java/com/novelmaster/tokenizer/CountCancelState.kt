package com.novelmaster.tokenizer

import java.util.concurrent.ConcurrentHashMap

/**
 * 计数取消状态机（tokenizer-native-cancel，2026-10-02）。
 *
 * 纯对象、零 Android 依赖：只包一张 [ConcurrentHashMap]，把「谁被取消了」这件事
 * 从 executor 任务体里剥出来，成为可在 JVM 直测的纯逻辑（对照
 * `CountCancelStateTest`）。取消信号单向——JS 侧 `cancelCount(requestId)` 置标记，
 * executor 任务在检查点读标记，任务收尾时清标记。
 *
 * **防陈旧标记**：`finish(id)` 直接 remove 该 id。这条很关键——JS 侧的 requestId
 * 是驱动层自增生成的（`${sessionId}:${seq}`），模块实例存活期内理论不复用；但
 * `invalidate()` 之外仍存在「标记置了、任务却从未真正跑起来」的空窗（例如任务在
 * 排队期间 Module 已析构），此时若不清标记，同一 id 下一轮会被误判为取消。
 * 「finish 即移除」让取消标记的生命周期严格等于一次任务的生命周期。
 *
 * 用 [ConcurrentHashMap] 而非 `Set`：JDK 8 的 `ConcurrentHashMap.newKeySet()` 在
 * 「contains 后 add」这类复合操作上不提供原子性，本类的语义只需要单键的
 * put/contains/remove 原子性，map 语义最贴切也最易读。
 */
internal object CountCancelState {

  private val cancelled = ConcurrentHashMap<String, Boolean>()

  /** 标记 [requestId] 已被取消（幂等：重复标记无副作用）。 */
  fun markCancelled(requestId: String) {
    cancelled[requestId] = true
  }

  /** 该 id 是否已被取消；未标记过返回 false。 */
  fun isCancelled(requestId: String): Boolean = cancelled.containsKey(requestId)

  /**
   * 任务收尾清理：移除 [requestId] 的取消标记，防止陈旧标记误杀后续同 id 的轮次。
   * 对未标记过的 id 调用是安全的空操作。
   */
  fun finish(requestId: String) {
    cancelled.remove(requestId)
  }

  /** 清空全部标记（Module 生命周期结束时的兜底清理）。 */
  fun clearAll() {
    cancelled.clear()
  }
}
