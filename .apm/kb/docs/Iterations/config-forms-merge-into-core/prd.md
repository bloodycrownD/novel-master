---

## date: 2026-06-12

dependency:

- Iterations/desktop-ui-polish/prd.md

# config-forms 合并进 core PRD

## 背景

Monorepo 当前将 Desktop / Mobile 共用的**配置编辑器纯 TS 逻辑**放在独立 workspace 包 `@novel-master/config-forms`（源于 [desktop-ui-polish](../desktop-ui-polish/spec.md) 方案 B，用于避免 Agent / 事件配置双端漂移）。

用户提出：`config-forms` 与 `cloud-sync-driver-s3` 均**非分平台包**（不像 `tdbc-driver-rn`、`sksp-android`），是否有必要独立存在、是否应「迁回 core」。

**现状澄清（探索结论）**：


| 包                                         | 是否在 core 内 | 是否分平台 | 当前职责                                                  |
| ----------------------------------------- | ---------- | ----- | ----------------------------------------------------- |
| `@novel-master/config-forms`              | **否**（独立包） | 否     | Agent / 事件配置表单状态、校验、工具策略序列化；仅 Desktop + Mobile 使用     |
| `@novel-master/cloud-sync-driver-s3`      | **否**（独立包） | 否     | 实现 core 的 `ObjectStoragePort`；依赖 `@aws-sdk/client-s3` |
| `@novel-master/core` 内 `infra/cloud-sync` | **是**      | 否     | 云同步协调器、锁、rev、端口定义；**不含** AWS SDK                      |


**合并合理性结论（已与用户确认）**：

- `**config-forms` → core：较合理** — 纯 TS、体量小、无重依赖；合并后减少 workspace 与 build 链复杂度。
- `**cloud-sync-driver-s3` → core：不合理** — 会迫使所有 core 消费者（含 CLI）引入 `@aws-sdk/client-s3`；与「端口在 core、驱动在外」既有模式不一致；云同步协调器已在 core，S3 驱动应保持可插拔与重依赖隔离。**本迭代不合并 S3 驱动。**

## 目标（含成功指标）


| 目标                            | 成功指标                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| 消除独立 `config-forms` workspace | 仓库中**不存在** `packages/config-forms/` 与 `@novel-master/config-forms` workspace 条目 |
| 能力不回归                         | Agent / 事件配置相关**行为与合并前一致**（Desktop + Mobile）                                    |
| 导入路径统一                        | 全部消费者改为从 `@novel-master/core/config-forms`（及子路径）导入                              |
| 构建与测试通过                       | `npm test -w @novel-master/core`、Desktop / Mobile 相关测试与 CI build 步骤**无新增失败**    |


## 用户与场景


| 用户                   | 场景                                                      |
| -------------------- | ------------------------------------------------------- |
| 维护者                  | 减少 packages 数量与 prebuild 依赖链，降低「该 import 哪个包」的心智负担      |
| Desktop / Mobile 开发者 | 继续共用 Agent、事件配置的表单逻辑，**无需**关心原独立包边界                     |
| CLI 开发者              | 无直接消费；合并后 CLI 仅体积略增（未使用的表单 helper），**不要求** CLI 改用表单 API |


## 范围

### 包含范围

1. **源码迁移**
  将 `packages/config-forms/src/`** 迁入 `packages/core/src/` 下合适目录（如 `config-forms/` 或 `service/config-forms/`，实现阶段按 core 既有结构定）。
2. **core 导出**
  在 `@novel-master/core` 增加子路径导出（与 `./tdbc`、`./sksp` 一致），至少包含：  
  - `@novel-master/core/config-forms`（或等价聚合入口）  
  - `@novel-master/core/config-forms/agent`  
  - `@novel-master/core/config-forms/events`
3. **消费者更新**
  更新 Desktop renderer、Mobile 组件/屏幕、Jest 映射、CI `npm run build -w` 脚本中对 `@novel-master/config-forms` 的引用。
4. **测试迁移**
  将 `packages/config-forms/test/`** 迁入 core 测试目录，纳入 `npm test -w @novel-master/core`。
5. **清理**
  删除 `packages/config-forms/package.json` 及 workspace 注册；更新根 `package-lock.json`。

### 不包含范围

- **不合并** `@novel-master/cloud-sync-driver-s3`（维持独立驱动包与 spec 约定）。
- **不修改** Agent / 事件配置的**产品行为**或 UI 交互（仅包路径与仓库结构变更）。
- **不强制** CLI 使用 config-forms API。
- **不处理** `config-forms` 与 core 间已知的小块重复逻辑（如 `application-model-id` 去重）——可另开迭代。

## 核心需求

1. `config-forms` 全部源码与单测位于 `@novel-master/core` 内，对外通过 **core 子路径** 导出。
2. Desktop / Mobile 所有 `@novel-master/config-forms/`* import **零残留**（含 Jest alias、脚本、CI）。
3. 删除独立 workspace 后，Mobile `prestart` / `pretest`、Desktop `prebuild`、GitHub Actions **不再** build `@novel-master/config-forms`。
4. 合并后 core 包仍**不引入** React、Electron、RN 或 AWS SDK 等平台/重依赖。
5. 在 APM 或 README 中简短说明：`config-forms` 已并入 core；`cloud-sync-driver-s3` 仍为独立驱动（可选文档更新，非阻塞）。

## 验收标准

- **Given** 合并完成，**When** 在仓库根执行 `git grep '@novel-master/config-forms'`，**Then** 无匹配（或仅历史文档/archived 中保留说明性引用）。
- **Given** Desktop 打开 Agent 编辑 / 事件配置 / 工具策略选择，**When** 保存并重新进入，**Then** 与合并前行为一致。
- **Given** Mobile 打开 Agent 编辑 / 事件配置 / 工具策略选择，**When** 保存并重新进入，**Then** 与合并前行为一致。
- **Given** 合并完成，**When** 执行 `npm test -w @novel-master/core`，**Then** 原 config-forms 单测用例全部通过。
- **Given** 合并完成，**When** 执行 Desktop / Mobile 现有相关测试（含 `validate-event-config-blocks` 等），**Then** 全部通过。
- **Given** CI release / build 工作流，**When** 触发 build，**Then** 不再包含 `@novel-master/config-forms` workspace build 步骤且整体成功。
- **Given** `@novel-master/cloud-sync-driver-s3`，**When** 本迭代结束，**Then** 仍为独立包，未并入 core。

## 风险与待确认项


| 项        | 说明                                                                      |
| -------- | ----------------------------------------------------------------------- |
| core 包体积 | CLI 等消费者会带上未使用的表单代码；当前可接受，若后续需 tree-shake 可再评估子路径-only 导入               |
| 文档滞后     | `desktop-ui-polish`、`tool-system-v2` 等 spec 仍引用旧包名；实现后需同步或注明 superseded |
| 导入路径变更   | 属**内部 monorepo 重构**，无 npm 公开发版 breaking；团队内需一次性改完 import                |
