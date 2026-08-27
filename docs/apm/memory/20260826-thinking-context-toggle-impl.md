# thinking-context-toggle 迭代实现（impl-thinking-context-toggle）

date: 2026-08-26
node: impl-thinking-context-toggle
worktree: .woktree/thinking-context-toggle（分支 feat/thinking-context-toggle）

## 请求

用户指令：按 `docs/Iterations/thinking-context-toggle/spec.md` Step 1~Step 11 全部实现（含 CLI parity Step 10）。核心要点：偏好三件套（preference-keys + PersistentPreferences，默认 true）；applyThinkingContextForLlm 纯函数（先判 requestThinkingEnabled 全局前置门 false 全剥 → 再按 enabled 分支；边界=排除 prompt: 前缀合成消息后最后一条含非 tool_result 块的 user 消息；最低保留=最后一条 assistant 且含 tool_use，不回溯；不可变返回）；T-TC1~T-TC8 单测；AgentTurnRuntimePort preferences 窄切片注入（覆盖主/子代理）；runner 插入点在 normalizeForLlmExport 之后、normalizeOrphanToolResultsForLlm 之前；savedModelForAppend null 时取 true；预览 opt-in 参数（includeThinking/includeThinkingBlocks 默认 false 不动计数 parity）+ 双端 prompt-preview.service 同口径（resolveSavedModelId 优先级 agent pin → session modelId，兜底 true）；desktop IPC 三件套 + 双端设置 UI 开关；CLI KNOWN_KEYS；全量回归（存量断言按新语义更新）。约束：worktree 根 npm install；按逻辑块提交；只改 spec 变更点范围；每块跑定向测试，最后 core 全量 + 双端相关测试（依赖 core dist 先 build）；UI 开关 qa: manual_user 的部分只写代码不做真机验收。全程中文（代码注释、commit message），标识符保持英文。

## 过程

- 通读 spec（4 轮审查修订版），边界规则与档位前置门以 spec 最终文本为准。
- npm install 于 worktree 根完成；顺带把全部 workspace 包（tdbc/sksp/tokenizer 驱动等）build 出 dist（测试与双端都消费 dist）。
- 按 Step 1→11 顺序实现，每块定向测试后按逻辑块提交；实现中修正两处自疏：开态保留/剥离方向反了、T-TC7 场景构造错误。
- 测试适配：savedModel mock 补必填 settings、allowlist 快照补新导出；desktop ipc client.ts 手写导出清单补新函数（vite 构建才拦截）。

## 结论

- Step 1~11 全部实现（含 CLI parity）；提交 11 个 commit（11b6110 → d6a2ce7，分支 feat/thinking-context-toggle）。
- 验证：core 全量 2174 pass；定向（偏好/纯函数/runner/预览/parity/thinking-signature）全过；desktop 84 pass；mobile 833 pass；CLI smoke（默认 true→set false→reset 回 true）通过；双端 typecheck 通过。
- 存量失败（与本次无关，基线验证同样失败）：CLI e2e `preferences-e2e` C5（session vfs write 缺 --session）、agent/regex/session 等 e2e；mobile `use-chat-tab-message-actions-unhide`（3 例）、`db-backup.service`（时序 act 警告）；core lint 3 个存量 error。
- UI（T-UI1/T-UI2）与真实服务商关态工具循环冒烟为 manual_user，待用户真机验收。
