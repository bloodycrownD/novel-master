package com.novelmaster.tokenizer

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * [CountCancelState] 的 JVM 直测（不依赖 android.content.Context，也不依赖词表
 * 资产与 cwd——这是把它单独抽成纯对象的全部意义）。
 *
 * 覆盖 T-TC7：标记命中/未命中、finish 后同 id 不可再判取消（防陈旧标记误杀下一
 * 轮）、clearAll、以及并发安全形态。
 */
class CountCancelStateTest {

  @Before
  fun setUp() {
    // 状态机是进程内单例，跨用例共享；每例前后都强制清干净，避免顺序耦合。
    CountCancelState.clearAll()
  }

  @After
  fun tearDown() {
    CountCancelState.clearAll()
  }

  @Test
  fun markedIdIsCancelledAndUnmarkedIdIsNot() {
    assertFalse("未标记过的 id 不应命中取消", CountCancelState.isCancelled("s-1:0"))

    CountCancelState.markCancelled("s-1:0")

    assertTrue("标记后必须命中取消", CountCancelState.isCancelled("s-1:0"))
    assertFalse(
      "取消标记必须按 id 隔离，别的 id 不受牵连",
      CountCancelState.isCancelled("s-1:1"),
    )
  }

  @Test
  fun repeatedMarkIsIdempotent() {
    CountCancelState.markCancelled("s-2:0")
    CountCancelState.markCancelled("s-2:0")

    assertTrue("重复标记不改变取消语义", CountCancelState.isCancelled("s-2:0"))
  }

  @Test
  fun finishClearsMarkSoStaleSignalCannotKillNextRound() {
    CountCancelState.markCancelled("s-3:0")
    assertTrue(CountCancelState.isCancelled("s-3:0"))

    // 模拟 executor 任务体 finally 收口。
    CountCancelState.finish("s-3:0")

    assertFalse(
      "finish 后同 id 必须不可再判取消——否则陈旧标记会误杀下一轮同 id 的计数",
      CountCancelState.isCancelled("s-3:0"),
    )
  }

  @Test
  fun finishOnUnknownIdIsSafeNoOp() {
    // 任务从未真正跑起来时也会走 finally，对没标记过的 id 清理不能炸。
    CountCancelState.finish("never-registered")
    assertFalse(CountCancelState.isCancelled("never-registered"))
  }

  @Test
  fun finishOnlyRemovesItsOwnId() {
    CountCancelState.markCancelled("keep-0")
    CountCancelState.markCancelled("drop-0")

    CountCancelState.finish("drop-0")

    assertTrue("其它 id 的标记不应被顺带清掉", CountCancelState.isCancelled("keep-0"))
    assertFalse(CountCancelState.isCancelled("drop-0"))
  }

  @Test
  fun markAfterFinishWorksAgain() {
    CountCancelState.markCancelled("s-4:0")
    CountCancelState.finish("s-4:0")
    // 第二轮又来一次取消：id 复用/重放时仍要能重新置位。
    CountCancelState.markCancelled("s-4:0")

    assertTrue(CountCancelState.isCancelled("s-4:0"))
  }

  @Test
  fun clearAllRemovesEveryMark() {
    CountCancelState.markCancelled("s-5:0")
    CountCancelState.markCancelled("s-5:1")
    CountCancelState.markCancelled("s-6:0")

    CountCancelState.clearAll()

    assertFalse(CountCancelState.isCancelled("s-5:0"))
    assertFalse(CountCancelState.isCancelled("s-5:1"))
    assertFalse(CountCancelState.isCancelled("s-6:0"))
  }

  /**
   * 并发安全形态（粗验，不做时序断言）：多线程同时 mark/isCancelled，同线程
   * 「标记后立刻查询」必须恒为 true；线程池里抛出的异常会被吞掉，所以失败原因
   * 收集到队列里在主线程断言。
   */
  @Test
  fun concurrentMarkAndQueryStaysConsistent() {
    val threadCount = 8
    val perThread = 500
    val failures = ConcurrentLinkedQueue<String>()
    val pool = Executors.newFixedThreadPool(threadCount)
    val start = CountDownLatch(1)
    val done = CountDownLatch(threadCount)

    repeat(threadCount) { t ->
      pool.execute {
        try {
          start.await()
          repeat(perThread) { i ->
            val id = "s-7:$t-$i"
            CountCancelState.markCancelled(id)
            if (!CountCancelState.isCancelled(id)) {
              failures.add("标记后立即查询未命中: $id")
            }
          }
        } catch (e: InterruptedException) {
          Thread.currentThread().interrupt()
          failures.add("线程被中断: ${e.message}")
        } catch (e: Throwable) {
          failures.add("并发操作抛异常: ${e.message}")
        } finally {
          done.countDown()
        }
      }
    }

    start.countDown()
    val finished = done.await(30, TimeUnit.SECONDS)
    pool.shutdownNow()

    assertTrue("并发标记应在 30s 内完成", finished)
    assertTrue("并发标记期间出现不一致: ${failures.toList()}", failures.isEmpty())

    // 收尾：所有标记都写进去了，且彼此不串。
    repeat(threadCount) { t ->
      repeat(perThread) { i ->
        assertTrue(
          "并发写入的标记 $t-$i 丢失",
          CountCancelState.isCancelled("s-7:$t-$i"),
        )
      }
    }
  }

  @Test
  fun concurrentFinishAndMarkDoNotCorruptTable() {
    // 语义相反的两类操作并发压一压：只要求「表不被搞坏」——不出异常、
    // 收尾后能整体清空。不对中间态做断言（那属于过度约束实现）。
    val threadCount = 6
    val perThread = 400
    val pool = Executors.newFixedThreadPool(threadCount)
    val start = CountDownLatch(1)
    val done = CountDownLatch(threadCount)
    val failures = ConcurrentLinkedQueue<String>()

    repeat(threadCount) { t ->
      pool.execute {
        try {
          start.await()
          repeat(perThread) { i ->
            val id = "s-8:${t % 2}-$i"
            if (t % 2 == 0) {
              CountCancelState.markCancelled(id)
            } else {
              CountCancelState.finish(id)
            }
          }
        } catch (e: Throwable) {
          failures.add("并发 finish/mark 抛异常: ${e.message}")
        } finally {
          done.countDown()
        }
      }
    }

    start.countDown()
    val finished = done.await(30, TimeUnit.SECONDS)
    pool.shutdownNow()

    assertTrue("并发 finish/mark 应在 30s 内完成", finished)
    assertTrue("并发 finish/mark 出现异常: ${failures.toList()}", failures.isEmpty())
    CountCancelState.clearAll()
    assertFalse(CountCancelState.isCancelled("s-8:0-0"))
  }
}
