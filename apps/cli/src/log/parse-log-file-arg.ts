/**
 * 全局参数 `--log-file <path>` 的摘除。
 *
 * 形态照 `vfs/parse-args.ts` 的 `extractDbPath`：在 `main` 入口把它从 argv 里
 * 摘掉并返回 `rest`，剩下的参数再走既有分发——否则子命令的参数解析会把它
 * 当成未知 flag。
 *
 * @module log/parse-log-file-arg
 */

// nm-style: keep-public — 全局参数摘除边界（spec T8 指定的文件与入口），与 `extractDbPath` 同构；main 只负责分发，argv 协议转换留在这里。
export function extractLogFilePath(argv: readonly string[]): { logFile?: string; rest: string[] } {
  const index = argv.indexOf("--log-file");
  const value = argv[index + 1];
  if (index < 0 || value == null) {
    return { rest: [...argv] };
  }
  return { logFile: value, rest: [...argv.slice(0, index), ...argv.slice(index + 2)] };
}
