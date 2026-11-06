package com.novelmaster.log

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Kotlin 侧未捕获异常落盘（logger-normalization T4 / spec 4.5）。
 *
 * 与 TS 侧 `services/log-sink.mobile.ts` 落同一个 `<filesDir>/logs` 目录、同口径：
 * 单文件 2MB 切段、任一时刻只留最新 5 份。`planLogFileWrite` 在 Kotlin 里调不到，
 * 切段/保留按同一规则有意重复实现（两侧常量互为指认）。
 *
 * 崩溃路径必须**同步**写：`uncaughtException` 之后进程随时可能被杀，异步落盘
 * 来不及。`context` 允许为 null 只为 JVM 单测：android 框架类在本地单测里构造
 * 会抛 `RuntimeException("Stub!")`，测试用 `install(null, tempDir)` 注入目录；
 * 生产调用永远传 Context。
 */
object NmLogCrashHandler {

  private const val PREFIX = "nm-crash-"
  /** 单文件上限 2MB（与 core `planLogFileWrite` 默认值一致）。 */
  private const val MAX_BYTES = 2L * 1024 * 1024
  /** 保留份数（与 core `planLogFileWrite` 默认值一致）。 */
  private const val KEEP = 5
  /** 分段号上限，超了退 `<hhmmss>` 段（与 core 策略一致）。 */
  private const val MAX_SEGMENT = 99

  private val lock = Any()
  private val dayFormat = SimpleDateFormat("yyyyMMdd", Locale.US)
  private val stampFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US)
  private val timeFormat = SimpleDateFormat("HHmmss", Locale.US)

  /**
   * 安装崩溃钩子：取旧处理器存下来，新处理器先写日志、再**链式**委派旧处理器
   * （不链式会让 RN 的异常处理与系统崩溃弹窗失效）。
   */
  fun install(context: Context?, logsDir: File = File(requireNotNull(context) { "logsDir 与 context 不能同时为空" }.filesDir, "logs")) {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      writeCrash(logsDir, thread, throwable)
      previous?.uncaughtException(thread, throwable) ?: throwable.printStackTrace()
    }
  }

  /** 一条崩溃 = 时间戳 + 线程名 + 完整堆栈；写盘失败静默（崩溃处理本身不能再抛）。 */
  private fun writeCrash(logsDir: File, thread: Thread, throwable: Throwable) {
    synchronized(lock) {
      try {
        if (logsDir.exists() || logsDir.mkdirs()) {
          val now = Date()
          val text = buildString {
            append(stampFormat.format(now))
            append('\t')
            append(thread.name)
            append('\n')
            val stack = StringWriter()
            throwable.printStackTrace(PrintWriter(stack))
            append(stack.toString())
            append('\n')
          }
          val bytes = text.toByteArray(Charsets.UTF_8)
          FileOutputStream(pickTarget(logsDir, dayFormat.format(now), bytes.size, now), true).use { out ->
            out.write(bytes)
            out.flush()
          }
          prune(logsDir)
        }
      } catch (_: Throwable) {
        // 吞掉：崩溃现场的记录是 best-effort，委派旧处理器才是不能丢的语义。
      }
    }
  }

  /** 段 0 写满则依次试 `.1`…`.99`，取第一个不存在或未超限的段；超上限退 `<hhmmss>` 段。 */
  private fun pickTarget(dir: File, dayKey: String, appendBytes: Int, now: Date): File {
    for (segment in 0..MAX_SEGMENT) {
      val file = File(dir, if (segment == 0) "$PREFIX$dayKey.log" else "$PREFIX$dayKey.$segment.log")
      if (!file.exists() || file.length() + appendBytes <= MAX_BYTES) {
        return file
      }
    }
    return File(dir, "$PREFIX$dayKey.${timeFormat.format(now)}.log")
  }

  /** 只保留最新 [KEEP] 份崩溃日志（按 lastModified 降序，同刻按名字降序）。 */
  private fun prune(dir: File) {
    val files = dir.listFiles { file -> file.isFile && file.name.startsWith(PREFIX) && file.name.endsWith(".log") } ?: return
    files.sortedWith(compareByDescending<File> { it.lastModified() }.thenByDescending { it.name }).drop(KEEP).forEach { it.delete() }
  }
}
