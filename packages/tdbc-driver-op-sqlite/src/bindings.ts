/**
 * 绑参归一化（Uint8Array → 独立 ArrayBuffer 拷贝、undefined → null）。
 *
 * @module tdbc-driver-op-sqlite/bindings
 */

/**
 * 为 @op-engineering/op-sqlite 归一化 execute/query 参数。
 *
 * op-sqlite 的 blob 绑参语义已在真机验证（荣耀 EBG-AN00，2026-09-28，
 * 6 项探针全 PASS：256B 全字节值 / 64KB 伪随机 / 4MB 伪随机 / 事务内 /
 * 带偏移视图 / 真实 codec 往返），确认可直接绑二进制 BLOB 往返无失真。
 * 防御性拷贝仍保留：它同时兜住「源视图带 byteOffset」这一与驱动无关的
 * 越界坑，VFS blob 写入路径的堆安全不赌假设。
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
      // 独立紧拷贝：源视图可能带 byteOffset（切片/subarray），直接绑参会越界；
      // 拷贝成紧凑 ArrayBuffer 兜底。保留拷贝也维持 quick-sqlite 时代的
      // 堆安全口径，不因 op-sqlite 验证通过而放松。
      return new Uint8Array(value).buffer;
    }
    return value;
  });
}
