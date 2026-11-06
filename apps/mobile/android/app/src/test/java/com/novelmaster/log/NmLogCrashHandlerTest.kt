package com.novelmaster.log

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.Date

/**
 * [NmLogCrashHandler] 的 JVM 直测（spec E3）。
 *
 * 不依赖 android.content.Context：本地单测里框架类一构造就抛 `Stub!`，
 * 所以 `install(null, tempDir)` 走可注入的 logsDir，用临时目录 + 假 Throwable
 * 验证「写文件 + 链式委派旧处理器 + 2MB 切段 + 只留 5 份」。
 */
class NmLogCrashHandlerTest {

  private lateinit var dir: File
  private var savedHandler: Thread.UncaughtExceptionHandler? = null
  private val previousCalls = mutableListOf<Pair<Thread, Throwable>>()

  @Before
  fun setUp() {
    dir = Files.createTempDirectory("nm-log-").toFile()
    savedHandler = Thread.getDefaultUncaughtExceptionHandler()
    previousCalls.clear()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable -> previousCalls.add(thread to throwable) }
    NmLogCrashHandler.install(null, dir)
  }

  @After
  fun tearDown() {
    Thread.setDefaultUncaughtExceptionHandler(savedHandler)
    dir.deleteRecursively()
  }

  @Test
  fun crashWritesFileAndDelegatesToPreviousHandler() {
    val handler = Thread.getDefaultUncaughtExceptionHandler()
    assertNotNull("install 后必须有默认处理器", handler)
    val throwable = IllegalStateException("boom-from-test")
    val thread = Thread.currentThread()

    handler!!.uncaughtException(thread, throwable)

    val file = File(dir, "nm-crash-${dayKey()}.log")
    assertTrue("崩溃日志应落在临时目录", file.exists())
    val text = file.readText()
    assertTrue("行首是本地时间戳", Regex("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}").containsMatchIn(text))
    assertTrue("包含线程名", text.contains(thread.name))
    assertTrue("包含异常类型与消息", text.contains("IllegalStateException") && text.contains("boom-from-test"))
    assertEquals("旧处理器必须被链式调用一次", 1, previousCalls.size)
    assertTrue("委派的是同一个 throwable", previousCalls[0].second === throwable)
  }

  @Test
  fun rotatesToSegmentOneWhenBaseFileExceedsLimit() {
    val base = File(dir, "nm-crash-${dayKey()}.log")
    val twoMb = 2 * 1024 * 1024
    FileOutputStream(base).use { it.write(ByteArray(twoMb)) }

    Thread.getDefaultUncaughtExceptionHandler()!!.uncaughtException(Thread.currentThread(), RuntimeException("rotate-me"))

    assertEquals("写满的段不应再被追加", twoMb.toLong(), base.length())
    val segment = File(dir, "nm-crash-${dayKey()}.1.log")
    assertTrue("超过 2MB 应切到 .1 段", segment.exists())
    assertTrue("崩溃内容落在新段", segment.readText().contains("rotate-me"))
  }

  @Test
  fun keepsOnlyFiveNewestCrashFiles() {
    for (day in 1..6) {
      val file = File(dir, "nm-crash-2020010$day.log")
      file.writeText("old-$day")
      file.setLastModified(1_000L + day)
    }

    Thread.getDefaultUncaughtExceptionHandler()!!.uncaughtException(Thread.currentThread(), RuntimeException("prune-me"))

    val crashFiles = dir.listFiles { file -> file.isFile && file.name.startsWith("nm-crash-") && file.name.endsWith(".log") }!!
    assertEquals("只保留最新 5 份", 5, crashFiles.size)
    assertTrue("本次崩溃是最后写入的一份", crashFiles.maxByOrNull { it.lastModified() }!!.readText().contains("prune-me"))
  }

  private fun dayKey(): String = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())
}
