/**
 * 把任意错误归一成 `Error`，并在前面拼上业务 fallback 文案。
 *
 * 跨端 YAML 导入导出都会用这个函数把 decode / 落库阶段的异常统一包装，
 * 这样调用方拿到的永远是带上下文提示的 Error，不用各自再判一次类型。
 */
export function normalizeYamlError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return new Error(`${fallback}：${error.message}`);
  }
  return new Error(fallback);
}
