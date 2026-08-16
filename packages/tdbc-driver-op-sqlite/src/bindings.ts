/**
 * 绑参归一化（Uint8Array → 独立 ArrayBuffer 拷贝、undefined → null）。
 *
 * @module tdbc-driver-op-sqlite/bindings
 */

/**
 * 为 @op-engineering/op-sqlite 归一化 execute/query 参数。
 *
 * op-sqlite 的 blob 绑参语义（是否持有/释放传入 buffer）尚未真机验证，
 * 保守保留 quick-sqlite 时代的防御性拷贝：VFS blob 写入路径的堆安全
 * 不赌假设。
 */
export function normalizeOpSqliteBindings(
  parameters?: readonly unknown[],
): unknown[] | undefined {
  if (parameters === undefined) {
    return undefined;
  }
  return parameters.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (value instanceof Uint8Array) {
      // 独立紧拷贝：quick-sqlite 会在绑定时释放 bound buffer，共享/
      // 切片视图会破坏堆；op-sqlite 语义待真机验证，保守保留拷贝。
      return new Uint8Array(value).buffer;
    }
    return value;
  });
}
