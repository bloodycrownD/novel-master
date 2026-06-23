---
date: 2026-06-21
dependency: Iterations/sksp/prd.md
---

# SKSP 密钥生命周期一致性（sksp-key-lifecycle）PRD

## 背景

[SKSP PRD](../../../sksp/prd.md) 已在 core 层交付 `SecretStore` 协议、`sksp_secrets` DDL、平台驱动与 `createCompositeSecretStore`（env 读优先、写仅 DB）。`packages/core` 第二轮 infra 审查（[explore.md](./explore.md)）确认：**无明文落库、API 不返回密钥** 等主路径安全，但 composite/env 与 provider 集成存在**语义不一致**，可能在 delete、status、实际请求之间产生分歧，并留下孤儿密文行。

| 问题域 | 严重度 | 摘要 |
|--------|--------|------|
| `ProviderService.delete` | P1 | 仅 `delete(provider.secretRef)`；读取路径使用 `secretRef ?? providerApiKeyRef(id)` → `secret_ref` 为 NULL 时 DB 密钥残留 |
| env 空字符串 | P2 | `EnvSecretStore.get` 返回 `""` 但 `has` 为 false → `apiKeyStatus` 与 `model request` 行为不一致 |
| `edit` 空 apiKey | P2 | 允许 `set(ref, "")`，DB 留无效密文行 |
| env 覆盖 DB | P1（信任面） | CLI/Desktop 传 env store；env 可静默覆盖 DB 而不改库，需文档化；Mobile 已不传 env |
| 备份含密文 | P1（产品面） | `dumpProviderTableSnapshot` 含 `sksp_secrets`；与 SKSP schema 无关，但运维/跨设备风险需跟踪 |

本 feature 为 **core-explore-remediation Phase 3** 增量 amend，**不推翻** SKSP 架构，仅修复 lifecycle 不对称与 env 边界语义，并补齐测试与文档。

**参考材料：** [explore.md](./explore.md)、[迭代 readme](../../readme.md)

## 目标（含成功指标）

| 目标 | 成功指标 |
|------|----------|
| delete 与 read 路径 ref 一致 | 删除 custom provider 时，无论 `llm_provider.secret_ref` 是否为 NULL，只要 SKSP 在 fallback ref 有密钥即清除 |
| env 空值语义统一 | env 未设或 `""` 时 composite 回退 DB；`has`/`get`/`apiKeyStatus` 一致 |
| 清除 apiKey 有明确定义 | `edit --apiKey ""`（或等价 patch）清除 SKSP 行并将 `secretRef` 置 NULL，而非写入空密文 |
| env 覆盖行为可运维 | SKSP 模块文档说明 env-over-DB、set/delete 仅 DB、Mobile 无 env；可选 `NM_SKSP_DISABLE_ENV=1` 供 Desktop/CLI |
| 测试回归门禁 | 新增/扩展单测覆盖上述场景；`npm run test:fast` 全绿 |

## 用户与场景

| 用户 | 场景 |
|------|------|
| CLI / Desktop 用户 | 删除 custom provider 后，`sksp_secrets` 无残留；`provider list` 的 `apiKeyStatus` 与能否成功 `model request` 一致 |
| CI / 脚本维护者 | 通过 `NOVEL_MASTER_PROVIDER_*_API_KEY` 注入密钥；空 env 不误判为「已设置」；需要时可禁用 env 覆盖 |
| Mobile 用户 | 生产 runtime 无 env store（现状保持）；行为不受本迭代 env 修复的副作用影响 |
| 核心库维护者 | 修改 provider/SKSP 后，有集成级测试防止 delete/read ref 再次分叉 |

## 范围

### 包含范围

1. **`ProviderService.delete`** — 使用 `provider.secretRef ?? providerApiKeyRef(id)`；`has(ref)` 为 true 时再 `delete(ref)`（与 `apiKeyStatus` / `resolveApiKey` 对齐）。
2. **`EnvSecretStore` + composite** — 将 env 空字符串 `""` 与 unset 同等视为 miss（`get` 归一化为 `null` 或 composite 层过滤）；`get`/`has` 一致。
3. **`ProviderService.edit`** — `patch.apiKey === ""` 时：`secretStore.delete(ref)` + `secretRef = null`（ref 同上 fallback）；禁止向 DB 写入空 apiKey 行。
4. **文档** — 在 `@novel-master/core/sksp` 模块注释或 ARCHITECTURE 片段中记录：env 读优先、写/删仅 DB、CLI/Desktop vs Mobile 接线差异。
5. **可选运行时开关** — `NM_SKSP_DISABLE_ENV=1` 时 CLI/Desktop composite 不传 env（或 env store 恒 miss）；Mobile 不变。
6. **测试** — `assertValidRef` 单测；composite env 空串 + DB 回退；provider delete 在 `secretRef=null` 且 DB 有 key 时清除；edit 空 apiKey 清除。

### 不包含范围

- SKSP **协议/DDL/驱动** 重写（Windows DPAPI、Android Keystore 实现不变）
- **备份 scrub/排除 `sksp_secrets`** 的产品实现（属 `infra/db-backup` / cross-device-cloud-sync；本 PRD 仅要求文档交叉引用与不在本迭代阻塞）
- **用户主密码**、跨平台密文迁移、密钥轮换 UI
- **`refToEnvVar` id 碰撞** 的代码级禁止（极端 provider id；P3 文档提醒即可）
- core 全路径统一调用 `assertValidRef`（未来 SKSP ref 扩展时再议）
- Desktop/Mobile provider UI 行为变更（仅 core + runtime 接线若需 env 开关）

## 核心需求

1. **Delete fallback ref：** custom provider 删除时，密钥清理 ref 解析必须与 `apiKeyStatus`、`ModelRequestService`、`ProviderModelService.resolveApiKey` 相同。
2. **Conditional delete：** 仅当 `secretStore.has(ref)` 为 true 时调用 `delete`；避免无意义调用，且 env-only 密钥（无 DB 行）时 delete 不报错（composite 仅删 DB）。
3. **Env falsy 归一化：** 环境变量未定义、`""`、或（SPEC 可选）仅空白字符，均视为 env miss，composite 回退 DB。
4. **Clear apiKey 语义：** 用户显式提交空 apiKey 表示「清除已存密钥」，而非存储空字符串 secret。
5. **Env 覆盖可观测：** 文档说明「UI/CLI 写入 DB 后，若 shell 仍 export env，实际 LLM 调用走 env」；内置 provider + 仅 env 配置仍为合法场景。
6. **Mobile 隔离：** `create-mobile-runtime` 继续 `createCompositeSecretStore({ db })` 不传 env。
7. **无 API 面密钥泄漏：** `ProviderListItem` 仍仅 `apiKeyStatus: "set" | "not set"`；本迭代不改变 public 契约。

## 验收标准

| ID | Given | When | Then |
|----|-------|------|------|
| K1 | custom provider，`secret_ref` 为 NULL，`sksp_secrets` 在 `provider/{id}/apiKey` 有行 | `ProviderService.delete(id)` | 该 ref 行被删除；provider 相关表行已删 |
| K2 | custom provider，`secret_ref` 指向有效 ref | delete | 与 K1 相同 ref 被清除（行为不退化） |
| K3 | env `NOVEL_MASTER_PROVIDER_X_API_KEY=""`，DB 有密钥 | `composite.get` / `has` / `apiKeyStatus` | 均回退 DB（status 为 set；get 返回 DB 明文） |
| K4 | env 未设置，DB 无行 | `has` / `get` | `not set` / `null` |
| K5 | provider 已有 DB 密钥 | `edit` patch `apiKey: ""` | `sksp_secrets` 对应行删除；`secret_ref` 为 NULL；`apiKeyStatus` 为 not set |
| K6 | 内置 provider，仅 env 有 key | `list` + `model request` | status 为 set；请求能取 env key（现状保持） |
| K7 | CLI/Desktop，`NM_SKSP_DISABLE_ENV=1` | 启动 runtime | composite 不读 env；仅 DB（与 Mobile 等价） |
| K8 | 文档 | 审阅 core/sksp 模块说明 | 含 env-over-DB、set/delete  asymmetry、Mobile 无 env |
| K9 | `npm run test:fast` | 全量执行 | 0 failures；含新增 SKSP/provider lifecycle 用例 |

## 约束与依赖

- **前置能力：** [SKSP PRD](../../../sksp/prd.md) / [SKSP SPEC](../../../sksp/spec.md) 已定义 `SecretStore`、composite 优先级、env 命名；本 feature 在其上 amend。
- **关联迭代：** `provider-model`（消费 SKSP 的 edit/list/request）；备份 scrub 与 `cross-device-cloud-sync` / db-backup 协调，**非本迭代交付**。
- **迭代位置：** `core-explore-remediation` Phase 3；建议在 Phase 1 正确性修复与 Phase 2 事件/配置之后实施。
- **文档后续：** 本 PRD 确认后进入 [spec.md](./spec.md)（design-proposal），再实施代码修改。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| env 清除语义 | composite `delete` 不清理 env（设计如此）；delete provider 后若 env 仍设，ref 无 owner 但密钥仍「存在」— 可接受，文档说明 |
| 破坏性变更 | 将 env `""` 从「有效空 key」改为 miss，可能影响极少数误配 CI；符合产品预期 |
| `NM_SKSP_DISABLE_ENV` | 可选需求；若排期紧可仅文档 + Mobile 模式，开关延后 |
