/**
 * chat 提示装配中途弃权的控制流哨兵（desktop / mobile / core 共用一份）。
 *
 * 读口在 build 分段间命中弃权条件即抛本错误，调用方捕获后按「保留旧标签」
 * 收场，**不触发 fallback 重算**；非读口消费方不传 `shouldBail`，行为不变。
 *
 * 定性见错误通道迁移 spec-3 §3.6「保留（控制流）」：保留 `extends Error` 供
 * `instanceof` 收窄，不迁 `AppError`（后续迭代再收敛到 `Outcome` / `Interrupt`）。
 * 上收 core 是为让两端导入同一个类——各建一份时 `instanceof` 跨包不成立。
 *
 * @module service/chat/model/chat-prompt-build-bailed-error
 */
export class ChatPromptBuildBailedError extends Error {
  constructor() {
    super("chat prompt build bailed (run in flight)");
    this.name = "ChatPromptBuildBailedError";
  }
}
