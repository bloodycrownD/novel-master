# 全局配置系统 PRD

## 背景

Novel Master 当前使用 `.novel-master/config.json` 存储应用级配置（如 `currentProviderId`、`currentModelId`、`currentProjectId`、`currentSessionId`），存在以下问题：
- 配置管理分散：JSON 文件与 KKV 系统并存，缺乏统一管理
- 扩展性差：新增配置项需要修改 JSON schema 和文件读写逻辑
- 功能开关缺失：如 `session-fs.versionCheck` 等功能开关无统一存储位置

需要基于现有 KKV 系统实现统一的全局配置管理，替换 `config.json`。

## 目标（含成功指标）

**目标**：实现基于 KKV 的应用级全局配置系统，统一管理应用配置与功能开关。

**成功指标**：
- `config.json` 完全移除，所有配置迁移到 KKV
- CLI 支持配置的增删改查操作
- 至少支持 5 个核心配置项（`currentProviderId`、`currentModelId`、`currentProjectId`、`currentSessionId`、`session-fs.versionCheck`）
- 配置变更后功能立即生效（如关闭 `session-fs.versionCheck` 后不再校验版本）

## 用户与场景

**用户**：Novel Master CLI 用户（开发者）

**场景**：
1. 设置默认 provider/model/project/session，避免每次命令都指定参数
2. 关闭 session-fs 的 version 校验，简化开发调试流程
3. 查看当前所有配置项及其值
4. 重置某个配置项到默认值

## 范围

### 包含范围
- 基于 KKV 实现全局配置存储（namespace: `global-config`）
- CLI 命令：`nm config set/get/list/reset`
- 迁移现有 `config.json` 的 4 个字段到 KKV
- 新增配置项：`session-fs.versionCheck`（默认 `true`）
- 配置持久化（存储在 `novel.db` 的 KKV 表）
- 配置生效验证（如 `session-fs.versionCheck=false` 时跳过版本校验）

### 不包含范围
- 项目级或 session 级配置覆盖（仅应用级全局配置）
- 配置项的类型校验与约束（v1 仅支持字符串和布尔值）
- 配置变更的审计日志
- 配置导入/导出功能
- 编程 API（仅 CLI 验证，内部调用通过 `ConfigService` 实现）

## 核心需求

1. **配置存储**：使用 KKV 系统存储全局配置，namespace 为 `global-config`，key 为配置项名称（如 `currentProviderId`、`session-fs.versionCheck`）

2. **CLI 命令**：
   - `nm config set <key> <value>`：设置配置项
   - `nm config get <key>`：获取配置项值
   - `nm config list`：列出所有配置项
   - `nm config reset <key>`：重置配置项到默认值（删除 KKV 记录）

3. **迁移 config.json**：
   - 移除 `.novel-master/config.json` 文件及相关读写逻辑
   - 将 `currentProviderId`、`currentModelId`、`currentProjectId`、`currentSessionId` 迁移到 KKV
   - 现有依赖 `config.json` 的代码改为调用 `ConfigService`

4. **功能开关生效**：
   - 新增配置项 `session-fs.versionCheck`（默认 `true`）
   - 当设置为 `false` 时，`session fs read/write/replace` 等命令跳过 version 校验

5. **默认值处理**：
   - 配置项未设置时返回预定义默认值（如 `session-fs.versionCheck` 默认 `true`）
   - `reset` 命令删除 KKV 记录，恢复默认值

## 验收标准

### 配置读写验证
- [ ] 执行 `nm config set currentProviderId test-provider`，再执行 `nm config get currentProviderId`，返回 `test-provider`
- [ ] 执行 `nm config set session-fs.versionCheck false`，再执行 `nm config get session-fs.versionCheck`，返回 `false`
- [ ] 执行 `nm config list`，显示所有已设置的配置项及其值

### 配置持久化验证
- [ ] 设置配置项后，重启 CLI（新进程），执行 `get` 命令仍能获取到之前设置的值

### 配置重置验证
- [ ] 执行 `nm config reset session-fs.versionCheck`，再执行 `get`，返回默认值 `true`

### 功能生效验证
- [ ] Given: 设置 `nm config set session-fs.versionCheck false`
- [ ] When: 执行 `nm session fs read <path>`（假设 version 不匹配）
- [ ] Then: 命令成功执行，不报 version 校验错误

### 迁移验证
- [ ] `.novel-master/config.json` 文件不再存在
- [ ] 原有依赖 `currentProviderId` 等字段的命令（如 `nm model list`）仍能正常工作
- [ ] 执行 `nm config get currentProviderId` 能获取到当前设置的 provider ID
