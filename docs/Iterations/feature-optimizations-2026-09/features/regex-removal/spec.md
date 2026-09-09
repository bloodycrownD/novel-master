---
date: 2026-09-06
---

# 正则系统移除技术规格（SPEC）

需求来源：`docs/Iterations/feature-optimizations-2026-09/features/regex-removal/prd.md`

## 设计目标

正则系统（v1.4.21 的消息正文替换：组/规则、llm/display 双通道、深度+角色过滤）从 core、desktop、mobile、CLI 全量移除，消息显示与 LLM 出站恢复原文直出；schema 幂等清理两表并推进版本；测试面同步收敛。

## 总体方案

纯减法，按 core → desktop → mobile → CLI → docs 顺序分层拆除（core 先行：双端 runtime 类型依赖 core 导出）。schema 走项目硬规则：`SCHEMA_BOOT_VERSION` 10→11，`NOVEL_MASTER_SCHEMA_STATEMENTS` 移除 regex 建表并加入两条 `DROP TABLE IF EXISTS`。

### 关键拍板（决策点与理由）

1. **DROP 放置**：放 `NOVEL_MASTER_SCHEMA_STATEMENTS`（慢路径执行）+ bump 10→11。三场景闭环：v10 存量库升级（bootVersion 10 < 11 走慢路径 → DROP）；全新库（建表语句已删，DROP 幂等 no-op）；云同步恢复旧备份（整库文件替换使 user_version 随备份回退 → 慢路径 → DROP）。不采用「两分支共用段强保证」——v11+ 快路径库被人为塞回表无现实入口，不值得为此偏离机制惯例。
2. **KKV 指针残留不清**：`currentRegexGroupId` 键随三方法删除后无人读写，无害残留；不为此加清理代码。
3. **mobile 薄包装保留并改名**：`loadSessionMessages*ForDisplay` 三个函数搬到新模块 `apps/mobile/src/services/session-messages-loader.ts`、去掉 `ForDisplay` 后缀（诚实命名），内部直调 `runtime.messages` 对应 API；四个 chat-tab 测试只改 jest.mock 路径与函数名，mock 面不变。desktop 侧 `messages.ts` handler 直接改调 `rt.messages.listBySession`（desktop 无同款 mock 纠缠）。
4. **abort 用例 T-CF1 重设计**：`run-agent-turn-abort-registry` 中靠 `getCurrentRegexGroupId` 抛错注入的用例，注入点随指针读取删除而消失——删除该注入用例（abort 计数覆盖由套件其余用例承担），其余断言保留。
5. **CHANGELOG**：`### 变更` 段 `**移除正则系统**` 条目，参照「移除事件配置系统」（CHANGELOG.md:340）写法：说明范围（正则组/规则配置、llm/display 双通道）与影响（消息与提示词恢复原文直出）。

### schema 机制现状（依据）

`bootstrapNovelMaster` 单事务：`PRAGMA user_version >= SCHEMA_BOOT_VERSION`（现 10）走快路径跳过全部 DDL；慢路径逐条执行 statements → migrations → ALIGN → 种子 → 写 user_version。幂等靠 `CREATE TABLE IF NOT EXISTS` + 版本合同。bump 写法以 v9/v10 注释块（`novel-master-bootstrap.ts:44-66`）为范本，追加 v11 注释。**改完必须 `npm run build -w @novel-master/core` 重建 dist**（mobile 经 metro 消费 dist；本项目 v9/v10 各踩过一次）。

## 最终项目结构

删除后不再存在的路径（节选）：

```
packages/core/src/domain/regex/           整目录
packages/core/src/service/regex/          整目录
packages/core/src/service/prompt/apply-regex-channel-for-llm.ts
packages/core/src/bootstrap/regex/        整目录
packages/core/src/errors/regex-errors.ts
packages/core/src/public/regex.ts
packages/core/src/domain/format/derive-regex-group-id.ts
packages/core/test/regex/                 整目录（3 文件）
packages/core/test/domain/regex/regex-rule-update-depth.test.ts（连带：import 已删模块，不删必编译红）
apps/desktop/src/main/ipc/handlers/regex.ts
apps/desktop/src/main/services/regex-apply-channel.service.ts
apps/desktop/renderer/services/regex-test.service.ts
apps/mobile/src/screens/stack/RegexGroupsScreen.tsx / RegexRulesScreen.tsx / RegexRuleEditorScreen.tsx
apps/mobile/src/components/regex/RegexGroupPickerModal.tsx
apps/mobile/src/services/regex-apply-channel.ts / regex-test.service.ts
apps/cli/src/regex/ / apps/cli/src/regex-group/   整目录
apps/cli/test/regex-e2e.test.ts
```

## 变更点清单（文件级）

### core（删 18 文件 + 改 10 处）

- 删：`domain/regex/` 全部（logic×4、model×3、ports、repositories×2+impl×2）、`domain/format/derive-regex-group-id.ts`、`service/regex/` 全部、`service/prompt/apply-regex-channel-for-llm.ts`、`bootstrap/regex/regex-schema.ts`、`errors/regex-errors.ts`、`public/regex.ts`。
- 改：
  - `bootstrap/novel-master-bootstrap.ts`：删 import 与 `...REGEX_SCHEMA_STATEMENTS`；statements 数组加 `DROP TABLE IF EXISTS regex_group;` `DROP TABLE IF EXISTS regex_rule;`（连带 `idx_regex_rule_group_sort` 随表消亡）；`SCHEMA_BOOT_VERSION` 10→11 + v11 注释。
  - `package.json:45-47` 删 `./regex` 导出块；`index.ts:134` 删 `KEY_CURRENT_REGEX_GROUP_ID` 导出。
  - `service/persistent-state/`：port 三方法（34-38）、impl（18, 91-100）、`workspace-state-keys.ts:14`。
  - agent 链路：`agent.port.ts:22-23`（activeRegexGroupId）；`agent-runner.ts`（16-17, 48, 57, 119, 345-353 含 `"after_regex_channel"` checkpoint、821-848 `applyLlmRegexChannelToVisible`）；`run-agent-turn.ts`（61, 125, 132, 485, 606, 714 注释, 738, 839）；`create-agent-runner.ts`（15, 58）；`assemble-agent-runner-deps.ts`（11, 34, 65）。
  - `config-forms/shared/ui-labels.ts:8-14` 删 `REGEX_UI_LABELS`（连带 `public/format.ts` 的 `deriveRegexGroupId` 导出删除）。
- 测试：删 `test/regex/` 三件；改 `format-utils.test.ts`（deriveRegexGroupId 用例）、`package-exports-t0.test.ts`（21, 63, 85 断言 `./regex` 可用→删除）、`persistent-state.test.ts`（11-23, 45, 59-63 两用例）、`package-exports/public-subpath-allowlist.test.ts`（14 删 SUBPATHS 的 "regex" 条目）+ 删 `snapshots/public-regex-allowlist.json` 快照、`test/service/agent/` 六文件 stub（run-agent-turn 91/118、abort-registry 127, 163-165, 245-317 含 T-CF1、project-agent 54/69、annotate-drafts-send 64/87、cli-parity 73/84、subsession-workspace-isolation 227, 263-265）。

### desktop（删 3 文件 + 改 ~10 文件）

- 删：`handlers/regex.ts`、`regex-apply-channel.service.ts`、`regex-test.service.ts`。
- 改：`shared/ipc-types.ts`（145-156 通道常量 + 1220-1279 DTO）；`handler-registry.ts`（80-92, 375-386）；`handlers/messages.ts`（37, 92 列表直调 `rt.messages.listBySession`）；`session-prompt-input.service.ts`（10, 41-66 去 llm 通道）；`runtime/types.ts`（39, 91）+ `create-desktop-runtime.ts`（34, 76, 154）；`shared/logic/config-forms-shared.ts:8`；`shared/logic/format.ts:8`；renderer `invoke-registry.ts`（506-543）、`client.ts`（136-146）、`SettingsViews.tsx`（imports 47-80 + 三个视图 1422-1885 直至文件尾）、`settings-nav.ts`（14-16, 35, 59, 72, 95-96）、`WorkspaceSettingsView.tsx`（16-17, 40-95, 128-145, 213-214, 319-327）、`SettingsOverlay.tsx`（19-21, 49-50, 152-157）。
- 测试：`messages-search-handler.test.ts` 与 `session-detail-drawer.test.ts` 行为断言保持绿（「搜索不套正则」锁定行为不变；it 标题含 regex 字样可顺手改名）。

### mobile（删 6 文件 + 改 8 文件）

- 删：三 Screen、`RegexGroupPickerModal.tsx`、`regex-apply-channel.ts`、`regex-test.service.ts`。
- 改：`navigation/types.ts`（29-31）、`header-config.ts`（31-33）、`RootNavigator.tsx`（31-33, 144-151, 245-251）、`ProfileTabScreen.tsx:49` 入口行、`useChatTabMessages.ts`（18-20, 93, 152 改 import 新 loader）、新增 `services/session-messages-loader.ts`（三函数：list/Tail/Page 直调 runtime.messages）、`session-prompt-input.service.ts`（21, 55-66 及 80 行 prepareUserMessagesForPrompt(regexMessages,…) 消费行一并清）、`services/prompt-preview.service.ts:2` 头注释去 regex 提及（行为已回正，仅注释漂移）、`runtime/types.ts`（38, 89）+ `create-mobile-runtime.ts`（31, 65, 156）。
- 测试：删 `regex-apply-channel.test.ts`、`regex-group-id.test.ts`、`regex-groups-screen-error.test.tsx`、`regex-preview-no-depth.test.ts`、`regex-test.service.test.ts`；改 `session-prompt-input.service.test.ts`（20-25 mock 与注释）、四个 chat-tab 系列 mock 路径与函数名（`chat-tab-screen.integration` 27-28/179-182、`legacy-scroll` 150-153、`use-chat-tab-message-actions-rollback` 37-40、`set-floor` 23-26）、`agent-run.service.integration.test.ts`（10, 45）。

### CLI（删 3 文件 + 改 5 文件）

- 删：`src/regex/commands.ts`、`src/regex/apply-channel.ts`、`src/regex-group/commands.ts`、`test/regex-e2e.test.ts`。
- 改：`main.ts`（21-22, 128-129, 178-182 分发注册）；`runtime.ts`（43, 156, 182, 263）；`prompt/commands.ts`（22, 71, 98-105）；`message/commands.ts`（12, 107, 117-128 直接用 visible）；`model/commands.ts`（16, 91-107）；`test/helpers.ts`（75 删 currentRegexGroupId 字段、261/267 删读取行——core 三方法删除后此处直接编译红）。CLI 无集中 help 清单，删注册即消失。

## 详细实现步骤

- Step 0 — phase-regex-reference — blocking: yes — qa: auto：开工前建参考留存：从开工时 dev HEAD（含正则系统完整源码）建 `regex-system-reference` 分支并检出 `.worktree/regex-system-reference` worktree，仅作浏览参考（不 npm install、不开发）；后续正则类功能（UI 或其他）借鉴用。验证：分支存在且 worktree 检出成功。
- Step 1 — phase-regex-core — blocking: yes — qa: auto：core 删域与服务、agent 链路六文件摘除接线、persistent-state 三方法、导出（package.json/index/public）、schema（DROP + statements 移除 + bump 11）；`npm run build -w @novel-master/core` 重建 dist。
- Step 2 — phase-regex-core — blocking: yes — qa: auto：core 测试收敛（删 `test/regex/`、改 format-utils/package-exports/persistent-state/agent 六 stub，T-CF1 按「关键拍板 4」处理），`npm test -w @novel-master/core` 全绿。
- Step 3 — phase-regex-desktop — blocking: yes — qa: auto：IPC 通道/DTO/handler/registry/invoke/client 删除，SettingsViews 三视图与 settings-nav、WorkspaceSettingsView、SettingsOverlay 清理，messages 直调，session-prompt-input 去 llm 通道，runtime 类型；`NODE_ENV=development npm test -w @novel-master/desktop` + typecheck 全绿。
- Step 4 — phase-regex-mobile — blocking: yes — qa: auto：删六文件、导航与入口清理、新 loader 模块、useChatTabMessages 改线、runtime 类型、session-prompt-input；测试按清单删改；`NODE_ENV=test npx jest` + `npm run typecheck` 全绿。
- Step 5 — phase-regex-cli — blocking: yes — qa: auto：删命令族与 e2e、main/runtime/prompt/message/model 消费段摘除；CLI 测试全绿。
- Step 6 — phase-regex-docs — blocking: no — qa: auto：CHANGELOG `### 变更` 移除条目。
- Step 7 — phase-regex-verify — blocking: no — qa: manual_user：真机升级存量库（v1.5.12 带 regex 数据）后启动正常、聊天原文显示、设置无正则入口。

## 测试策略

- T-RX1 — blocking: yes — schema 三场景：v10 库（含表与数据）boot 后表消失且 user_version=11；全新库无表；恢复 v10 备份文件后再 boot 表再次被清。挂点：`packages/core/test/bootstrap/`（并入 bootstrap-ddl-smoke 或新增独立用例文件，实现者裁量）。
- T-RX2 — blocking: yes — 导出面：`@novel-master/core` 无 `./regex` 子路径（package-exports 断言改后绿）；主入口无 `KEY_CURRENT_REGEX_GROUP_ID`。
- T-RX3 — blocking: yes — core 全量测试绿（agent stub 清理后，run-agent-turn/abort-registry/cli-parity 等套件不回归）。
- T-RX4 — blocking: yes — llm/display 直出：既有 run-agent-turn 与消息链路用例在摘除正则后语义不变（含 desktop T-DI5 搜索原文行为锁定保持绿）。
- T-RX5 — blocking: yes — desktop：设置页无「正则过滤」入口、工作区设置无「当前正则组」行（渲染断言）；12 通道类型面删除后 typecheck 0。
- T-RX6 — blocking: yes — mobile：「我的」页无「正则配置」入口；chat-tab 四套件 mock 迁移后绿。
- T-RX7 — blocking: yes — CLI：regex/regex-group 命令不可达（分发无注册）；prompt/message/model 输出原文（现有测试改后绿）。
- T-RX8 — manual_user — 真机升级验收（Step 7）。

勿误伤清单（保留不动）：`domain/depth`（matchDepth 等为压缩链路共享）、grep 工具正则模式（vfs-tools.ts:433-474）、mention 标记检测、`normalize-orphan-tool-results-for-llm.ts`（仅注释提及）、examples/mobile 原型残留（另议）。

## 风险与回滚方案

- 风险：忘 bump SCHEMA_BOOT_VERSION 或忘重建 dist → 真机 no such column 类老坑（#10）；spec 已把两项写进 Step 1 硬门槛。
- 风险：mobile 四套件 mock 迁移漏改 → T-RX6 兜底全量 jest。
- 风险：desktop SettingsViews 大段删除后 imports 残留 → typecheck + lint/knip 收敛（worktree 内 lint 误报不算回归，#33）。
- 回滚：整体 revert 提交可完整恢复（无数据不可逆操作：DROP 只清正则表，恢复代码后表会重建为空——原正则数据不恢复，属 PRD 已拍板接受的损失）。
