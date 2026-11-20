/**
 * 库文件已换代、其后收尾步骤失败的控制流哨兵（desktop / mobile / core 共用一份）。
 *
 * 成功路径走返回值（`{ databaseReplaced }`）；抛错路径下返回值送不到调用方，
 * 「已换代」信号只能由异常类型承载，调用方 `catch` 后按 `instanceof` 收窄。
 * 此时**不得回滚**——库已经是新快照，回滚会把用户拉回来的数据丢掉。
 *
 * 定性见错误通道迁移 spec-3 §3.6「保留（控制流）」：保留 `extends Error` 与
 * brand 字段 `databaseReplaced`，不迁 `AppError`。上收 core 是为让两端导入同一个
 * 类——各建一份时 `instanceof` 跨包不成立。
 *
 * @module infra/cloud-sync/model/database-replaced-error
 */
export class DatabaseReplacedError extends Error {
  /** 换代 brand：调用方除 `instanceof` 外的第二重判别。 */
  readonly databaseReplaced = true as const;

  constructor(message: string, readonly providerTablesRestored: boolean) {
    super(message);
    this.name = "DatabaseReplacedError";
  }
}
