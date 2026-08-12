# CR Fix Spec: mobile-desktop-optimization-2026-08

## 元信息
- repo: /home/bloodycrown/Dev/novel-master
- base_sha: d19472b（main）
- head_sha: 各 feature 分支 HEAD
- prd_path: docs/Iterations/mobile-desktop-optimization-2026-08/prd.md
- spec_paths:
  - A: docs/Iterations/mobile-desktop-optimization-2026-08/features/A-subagent-workspace-isolation/spec.md
  - B: docs/Iterations/mobile-desktop-optimization-2026-08/features/B-agent-config-cleanup/spec.md
  - C: docs/Iterations/mobile-desktop-optimization-2026-08/features/C-ui-optimization/spec.md
  - D: docs/Iterations/mobile-desktop-optimization-2026-08/features/D-bug-fixes/spec.md
- review_round: 1
- dag_version: 2
- 状态：fix-spec-ready

## Must-fix（按 P1 → P2）

### CR-C1 [P1] 清理 worktree 污染文件（.apm/memory/dynamic.md + .gitignore）
- 维度：G（卫生）/ K（收尾）
- 来源：review-scope-C（C-MF1），review-scope-B（D-7），review-full（NEW-1）
- worktree：所有 4 个 feature 分支均有此问题
- 文件：`.apm/memory/dynamic.md` + `.gitignore`
- 问题：
  1. `.apm/memory/dynamic.md` 被覆写成与各 feature 完全无关的内容（Linux SKSP driver 等），是 agent 工作流串入的污染
  2. `.gitignore` 被加了 `.woktree/` 忽略规则，也是 worktree 工作流串入——应该在 main 上单独提 chore commit，而不是跟着 feature 分支进 main
- 改法：
  1. 各 worktree 执行 `git checkout d19472b -- .apm/memory/dynamic.md .gitignore`（恢复到 main 版本）
  2. 如果确实需要忽略 `.woktree/`，在 main 上单独提一个 chore commit
- 验收：`git diff d19472b..HEAD -- .apm/memory/dynamic.md .gitignore` 应为空
- 注意：`.apm` 在 `.gitignore` 里，正常不应被提交

### CR-A1 [P2] 清理 runChildAgent 死参数 parentSessionId
- 维度：G（死代码）
- 来源：review-scope-A（MF-1）
- worktree：feature-a-subagent-workspace
- 文件：`packages/core/src/service/agent/logic/run-agent-turn.ts`
- 问题：Feature A 把 VFS 装配和 ChatAgentSession 构造都改成 childSessionId 后，`runChildAgent` 的 `parentSessionId` 参数（L591 args 类型声明）成了死参数——签名声明 + 两个调用点（L517, L717）都传，但函数体不解构也不引用
- 改法：
  1. 从 `runChildAgent` 的 args 类型删 `readonly parentSessionId: string`
  2. 从两个调用点删 `parentSessionId` 字段（L513 `parentSessionId: scope.sessionId`、L717 `parentSessionId: childSessionId`）
  3. **注意别删 L483/L684 附近的 `EVENT_SUBAGENT_CHILD_SESSION_CREATED` 事件 payload 里的 `parentSessionId` 字段**（那是事件字段名，不是函数参数）
- 验收：core 全量测试通过；grep 确认 `runChildAgent` 签名/调用点无 parentSessionId 残留（事件 payload 除外）

### CR-A2 [P2] 更新 nav-workspace.ts 过时注释
- 维度：A（注释一致性）
- 来源：review-scope-A（MF-2）
- worktree：feature-a-subagent-workspace
- 文件：`apps/desktop/renderer/state/nav-workspace.ts` L19
- 问题：注释「子智能体只读会话面板与父会话共享聊天工作区预览面板（P2-11）」已过时——Feature A 后子会话有独立工作区
- 改法：改注释为反映 Feature A 后语义——panelScope 仍为 `"chat"`（session 级 VFS），但 `workspaceSessionId` 在子会话 view 下指向子 session（见 ShellNavProvider），实际展示子 session 自己的工作区
- 验收：desktop typecheck 通过

### CR-B1 [P2] desktop model toast 文案改 none 口径
- 维度：C（质量）
- 来源：review-scope-B（M-1），cr-func-B（D-1）
- worktree：feature-b-agent-config
- 文件：`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx` L234 附近
- 问题：model 卡锁定 toast 仍「当前智能体已锁定模型，请先在智能体配置中修改。」，spec Step 5 要求改成「当前智能体已锁定模型，会话内无法覆盖。」
- 改法：L234 `showToast("当前智能体已锁定模型，请先在智能体配置中修改。")` → `showToast("当前智能体已锁定模型，会话内无法覆盖。")`
- 验收：`apps/desktop/test/session-detail-drawer.test.ts` 补 `assert.match(src, /会话内无法覆盖/)`

### CR-B2 [P2] 删除 extractExtraInfoBlock 死代码
- 维度：G（死代码）
- 来源：review-scope-B（M-3）
- worktree：feature-b-agent-config
- 文件：`packages/core/test/agent/agent-runner.test.ts`
- 问题：`extractExtraInfoBlock` 函数定义（L30-33）保留但已无调用方，只有 `void extractExtraInfoBlock;`（L1565）消除警告
- 改法：删 L30-33 函数定义 + L1565 `void extractExtraInfoBlock;`
- 验收：core agent-runner 测试通过

### CR-B3 [P2] core ProjectService 加 @deprecated
- 维度：G（一致性）
- 来源：review-scope-B（M-4）
- worktree：feature-b-agent-config
- 文件：`packages/core/src/service/chat/impl/project.service.ts` L185-220
- 问题：core `ProjectService.getAgentConfig`/`updateAgentConfig` 仍是完整实现，没有 `@deprecated` 标注（与 model 层不一致）
- 改法：两个方法上加 `@deprecated` JSDoc，说明"项目智能体已下线，保留用于 DB 历史数据读取兼容"
- 验收：core typecheck 通过

### CR-B4 [P2] T-EA4 测试标题笔误
- 维度：G（文档准确性）
- 来源：review-scope-B（D-4），cr-func-B
- worktree：feature-b-agent-config
- 文件：`packages/core/test/chat/prepare-user-messages-for-prompt.test.ts`
- 问题：T-EA4 标题「hidden user 不影响『最新一条』判定，hidden **不进输出**」与测试体矛盾（测试断言 hidden 进输出只是不带 wrap）
- 改法：标题改成「hidden user 不影响『最新一条』判定，hidden 原样进输出但不注入」
- 验收：测试仍通过（只改标题不改逻辑）

### CR-C2 [P2] 服务商 tab 默认页体验
- 维度：C（用户体验）
- 来源：review-scope-C（C-MF2）
- worktree：feature-c-ui-optimization
- 文件：
  - `apps/mobile/src/screens/stack/ProviderDetailScreen.tsx`（useState 初值）
  - `apps/desktop/renderer/features/settings/SettingsViews.tsx`（useState 初值）
- 问题：create 服务商后 `push("providerDetail")` 默认落 `models` tab，但用户刚 create 完通常想立刻调连接信息（config tab）
- 改法（推荐方案 A——简单）：默认 tab 改 `'config'`
  - mobile：`useState<'config' | 'models'>('config')`
  - desktop：`useState<ProviderTab>("config")`
  - 更新源码注释为「默认服务商配置，create 后直接可编辑」
- 备选方案 B（精细）：保持默认 `models`，create 流程 push 后设 navState 标记强制落 `config`
- 验收：双端 provider-detail-tabs 测试更新默认 tab 断言；手工 create 服务商后确认落到 config tab
- 注意：PRD 允许实现自决，这条是体验优化不是 bug

## Spec deviations

| id | 偏差 | 认定 |
|----|------|------|
| A-SD-1 | desktop UI 方案变体（workspaceSessionId 派生字段 vs spec 的枚举新增） | ✅ 功能等价，认定接受 |
| A-SD-2 | initializeEmptySessionWorkspace 只清 VFS 不碰 KKV | ✅ 合理偏差，认定接受 |
| A-SD-3 | subagent-tool-vfs.test.ts 注释修正 | ✅ 认定接受 |
| B-SD-1 | desktop model toast 文案（→ CR-B1 修复） | 待修复 |
| B-SD-2 | ProjectAgentConfig 类型保留 deprecated | ✅ 合理，与 DB 列保留策略一致 |
| B-SD-3 | IPC handler 保留 deprecated 兜底 | ✅ 同 B-SD-2 |
| B-SD-4 | T-EA4 标题笔误（→ CR-B4 修复） | 待修复 |
| B-SD-5 | spec 现状描述失准（mobile 入口非"已重构掉"而是本期删） | 文档问题，不影响代码 |
| C-SD-1 | Step 1.1 未抽 FormMultiSelectSheet | ✅ spec 有弹性条款 |
| C-SD-2 | ProviderConfigTab 复用 ProviderForm 而非 ProviderEdit | ✅ 合理（ProviderEdit 已删） |
| D-SD-1 | console.warn 未加 dev 守卫 | ✅ webview 无 process.env，合理 |
| D-SD-2 | 多 3 条加固用例 | ✅ 正向加固 |

## Open questions / 待拍板

1. **B-SD-5 → CR-NEW-2（P3，spec 文档修正）**：Feature B 的 spec 反复说"mobile 入口已重构掉、本期无删除动作"，但实际本期删除了大量 mobile 文件（ProjectAgentConfigScreen + AgentEditorForm project 分支 + 路由 + 测试）。实现是对的，但 spec 描述与实际严重不符。建议合并前或合并时修正 spec Step 4、变更点清单、风险章节。不阻塞合并。
2. **B 双端预览多条 user 收窄测试（T-EA3）**：spec Step 2 要求改双端 session-prompt-input.service.test.ts，实际只改了 core 的 agent-runner.test.ts。预览路径理论上走同一条 prepare 自动一致（core 层 T-EA1/T-EA2 已覆盖注入收窄逻辑），风险低。建议接受偏差，不阻塞合并。
3. **合并顺序**：建议 B → D → A → C。B 先进（删除最多，后续 feature rebase 更干净）；D 的 public/chat.ts 改动在 B 后面不同区域；A 的 ChatRail 改动在 B 删除后需要 rebase；C 最后进。合并后跑一轮全量 typecheck + test 确认。

## 已豁免

（无）

## 合并后 QA（manual_user）

- A: desktop T-UI-1/2/3/4（子会话工作区预览可见 + 刷新 + 嵌套 + 保留）
- B: 双端项目智能体入口确实不可见；锁定 UI none 场景 toast 文案
- C: picker sheet 交互（T-H1~H7）、生成中兜底真机验证、tab 切换手工验证
- D: Bug1 真机定位（write/edit 跳转，blocking: no）

## K 节建议（下游执行时闭合）

- 合并后在完整环境（非 worktree）跑一轮 desktop 全量测试（worktree 跑不了 desktop test runner）
- 合并后 `npm run typecheck` 全量确认（worktree 的 node_modules symlink 问题可能掩盖问题）
- `workspace-footer-reload.test.ts` 既有缺陷（main 就坏）建议独立修
