/**
 * VFS 导入分片的共享常量与切片工具。
 *
 * @module domain/vfs/logic/vfs-import-chunk
 */

/**
 * 导入分片提交时**每条短事务**最多写入的文件数。
 *
 * 量级理由：**事务持有时间上界**。移动端历史上因大事务触发过 SQLite 写磁盘
 * 临时表的 `disk I/O error`（换 op-sqlite + `SQLITE_TEMP_STORE=2` 只治了症状）。
 * 与 `SqliteMessageRepository.BATCH_PARAM_BUILD_CHUNK = 200` 取同一量级。
 *
 * ⚠️ 刻意**不**挂 `SQLITE_MAX_VARIABLE_NUMBER`：导入分片路径不使用变量列表，
 * 「≤999 变量上限」这条约束对本处分片不成立。
 */
export const ZIP_AND_CARD_IMPORT_TXN_FILE_CHUNK = 200;

/**
 * 片与片之间的事件循环让步。
 *
 * RULE：让步**只能落在片与片之间，绝不能落在事务回调内部**（事务内语句须
 * 同步执行）。这里统一成按 16ms 时间量子让出，而不是逐语句让步。
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 把数组按固定大小切成若干片（返回生成器，零额外数组）。
 *
 * 空数组产出 0 片——调用方据此跳过整个分片循环（只跑段 B0）。
 */
export function* chunkArray<T>(
  items: ReadonlyArray<T>,
  size: number
): Generator<ReadonlyArray<T>> {
  for (let offset = 0; offset < items.length; offset += size) {
    yield items.slice(offset, offset + size);
  }
}
