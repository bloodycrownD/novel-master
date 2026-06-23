---
date: 2026-06-21
dependency: []
---

# Feature Flag 配置接入（feature-flags-config）PRD

## 背景

`packages/core` 的 `feature-flags` 域当前为**最小脚手架**：仅一个开关 `userVfsUnifiedToolTurn`（用户 VFS 统一 tool turn），实现为纯函数 `isUserVfsUnifiedToolTurnEnabled(configured?)`，默认 `true`。所有生产调用点均**无参**调用，可选参数 `configured` 从未传入，因此开关**恒为开启**，无法作为生产回滚杠杆。

该开关在 [vfs-user-ops-unified-tool-turn](../../../vfs-user-ops-unified-tool-turn/spec.md) 规范 §739、§875 中已承诺：关闭时恢复**直写 VFS** + **vfs markDirty** + **旧 transcript 行为**。Core 与消费者（`runAgentTurn`、Desktop VFS IPC、Mobile 文件 UI）已按同一函数分支，但**关闭路径不可达**。

`PersistentPreferences`（KKV `nm-preferences`）已是跨端行为配置权威（如 `session-fs.versionCheck`、`chat.llmStream`），feature flag 尚未接入。Explore 评级 **C+**（恒 true）；本 feature 属 `core-explore-remediation` **Phase 4 / P2**。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)、[feature-flags 域 CR](../../../../../../docs/explore/domain/feature-flags.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| 将 `userVfsUnifiedToolTurn` 接入持久化配置 | `nm-preferences` 存在键 `vfs.userVfsUnifiedToolTurn`；未设置时默认 `true` |
| 启用可操作的运行时回滚 | 配置为 `false` 或 env `NM_USER_VFS_UNIFIED_TOOL_TURN=0` 时，三端 consumer 走旧直写路径 |
| 保持跨层一致性 | Core agent flush、Desktop IPC、Mobile UI 读取**同一**有效值（无各 app 自行传参漂移） |
| 补齐测试与文档 | flag 域单测 + `runAgentTurn` 关闭分支测试；runbook 可引用 CLI/env 回滚步骤 |
| 不破坏默认 happy path | 未配置时行为与今日一致（统一 tool turn 开启） |

## 用户与场景

| 用户 | 场景 |
|------|------|
| 核心库维护者 | 统一 tool turn 上线后若遇 transcript/flush 问题，需**不重新部署**即可回滚到直写 VFS |
| Desktop / Mobile 开发者 | IPC 与 UI 分支已与 flag 对齐，需 flag 反映用户/运维配置而非编译期常量 |
| CLI / 运维 | 通过 `nm preferences set vfs.userVfsUnifiedToolTurn false` 或 env 在本地/CI 验证回滚路径 |
| 发布负责人 | 发布 runbook 引用单一开关名与验收步骤，对齐 vfs-user-ops-unified-tool-turn 规范 |

## 范围

### 包含范围

- **Core domain**：扩展 `isUserVfsUnifiedToolTurnEnabled` 读取链（显式 override → env → preferences 快照 → 默认 `true`）；提供 preferences 快照刷新 API 供 runtime 启动时调用
- **PersistentPreferences**：新增 typed API（`get/set/resetUserVfsUnifiedToolTurn`）与 canonical key `vfs.userVfsUnifiedToolTurn`
- **Runtime 接线**：Desktop / Mobile / CLI 在 runtime bootstrap 后从 `preferences` 刷新 flag 快照（与现有 `preferences` 使用方式一致）
- **CLI**：`nm preferences` 支持新 key 的 set/get/reset/list
- **测试**：
  - `test/domain/feature-flags/user-vfs-unified-tool-turn.test.ts`（默认、override、env）
  - `run-agent-turn` 关闭开关时不调用 flush 的集成断言
  - preferences round-trip 单测
- **公共导出**：将 flag 符号从 `@novel-master/core/provider` 迁至语义匹配入口（`@novel-master/core/vfs` 或 `@novel-master/core/feature-flags`）；`provider` 保留 `@deprecated` 再导出一个版本周期
- **JSDoc / runbook 注记**：模块头说明配置来源与 env 紧急 override

### 不包含范围

- 新增第二个 feature flag 或通用 `FeatureFlagsPort` 框架（留待 flag 数量 >1 时再建）
- Desktop / Mobile **设置页 UI** 开关（本迭代仅 plumbing + CLI；UI 可后续迭代接入同一 preferences API）
- `chat-user-vfs-turn` 范围内的 flush 事务性、部分 tool 失败语义变更
- `public-api-boundaries` 全量 export 收敛（本 feature 仅搬迁本 flag 相关符号）
- Bootstrap 历史 migrate（无 schema 变更，仅新 preference key）
- 应用层 E2E（Desktop/Mobile 直写 VFS 回退 smoke 可选手工验收，不强制自动化）

## 核心需求

1. **单一有效值来源**：生产路径禁止各 consumer 自行传入不同的 `configured`；以 core 内统一读取链为准（preferences 快照 + env override）。
2. **默认开启不变**：`DEFAULT_USER_VFS_UNIFIED_TOOL_TURN = true`；未写入 preferences 时与当前行为一致。
3. **Preferences 键**：`vfs.userVfsUnifiedToolTurn`，布尔，存储格式与现有 `chat.llmStream` 相同（`"true"` / `"false"`）。
4. **Env 紧急 override**：`NM_USER_VFS_UNIFIED_TOOL_TURN=0` 强制关闭（同步可读，便于 adb/终端排障）；`=1` 或未设置时不单独强制开启（仍尊重 preferences 快照）。
5. **回滚行为（关闭时）**：
   - `runAgentTurn`：**不**调用 `flushPendingUserVfsTurnsWithTrailingUserReorder`
   - Desktop session scope VFS IPC（write/mkdir/delete/rename）：**直写** `vfs.*`，恢复 markDirty / snapshot invalidate 既有逻辑
   - Mobile session scope 文件操作：**直写** VFS，不经 `userVfsTurn.execute`
6. **Runtime 刷新**：各 app runtime 初始化后、`preferences` 可用时调用一次快照刷新；preferences 变更后若需即时生效，至少 CLI 重启 / app 重启可生效（本迭代不要求热更新监听）。
7. **测试覆盖负路径**：关闭开关时 core 集成测试证明 flush 被跳过；flag 模块四条基础断言（explore 建议）。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| F1 | 无 env、无 preference 行 | 调用 `isUserVfsUnifiedToolTurnEnabled()` | 返回 `true` |
| F2 | `configured: false` 显式传入 | 调用函数 | 返回 `false`（测试 / DI 用） |
| F3 | `NM_USER_VFS_UNIFIED_TOOL_TURN=0` | 无显式 override | 返回 `false` |
| F4 | preferences 设为 `false` 且已 refresh 快照 | 无 env override | 返回 `false` |
| F5 | preferences `false`，env 未设置 | `runAgentTurn` 且存在 pending user Vfs turn | **不**调用 flush |
| F6 | preferences `true`（默认） | 现有 `run-agent-turn.test.ts` 套件 | 全部通过，flush 行为不退化 |
| F7 | CLI | `nm preferences set vfs.userVfsUnifiedToolTurn false` 后 get | 读回 `false` |
| F8 | `npm run test:fast` | 本 feature 改动合并后 | 无新增失败 |
| F9 | Desktop/Mobile import | 编译通过 | 可从新 public 路径导入 flag 符号；旧 `provider` 路径仍可用（deprecated） |

## 约束与依赖

- **dependency: []** — 不阻塞其它 Phase 4 feature；与 `vfs-user-ops-unified-tool-turn` 实现**互补**（补齐规范承诺的 flag 接线，不重复 U-A-U-A 主体）。
- **前置能力**：`PersistentPreferences`、`UserVfsTurnService`、`runAgentTurn` flush 编排、Desktop/Mobile VFS 分支已存在。
- **迭代位置**：Phase 4；建议在 Phase 2 `chat-user-vfs-turn` 稳定后实施，但无硬依赖。
- **文档后续**：本 PRD 确认后进入 [spec.md](./spec.md)（design-proposal），再实施代码修改。
