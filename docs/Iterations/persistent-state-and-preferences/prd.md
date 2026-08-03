# 持久化状态与持久化配置 PRD

> **实现范围（2026-05-30）**：本迭代仅交付 **`packages/core` + `apps/cli`**。RN App、Electron 后续迭代接入同一公开 API；详见同目录 `spec.md`。  
> **Supersedes**：`Iterations/global-config-system`（产品方向由本迭代承接）。

## 背景

Novel Master 业务数据落在 `novel.db`。CLI 曾用 **`.novel-master/config.json`** 存当前 project/session；后改为 **`ConfigService` + KKV `global-config`**，与「行为偏好」（如 `session-fs.versionCheck`）混在同一抽象里。

现状问题：

- **语义混杂**：工作区指针（`current*`）与工具偏好不应共用「全局配置」桶。
- **对外暴露 KKV**：`KkvService`、`nm kkv` 易导致各端自行约定 key，长期不利于多客户端。
- **文档滞后**：部分文档仍写 `config.json`；实际上 **CLI 代码已不再读写 `config.json`**（仅存用户磁盘上的遗留文件，可手动删除）。

产品方向：**对外隐藏 KKV**；仅暴露 **持久化状态** + **持久化配置** 两个薄端口；UI/内存状态不进 core。

## 目标（含成功指标）

**目标**：用两个领域端口替代 `ConfigService` / `global-config`，CLI 全量改用；core 公开 API 可供未来 App/Electron 直接消费。

**成功指标（本迭代）**：

- `@novel-master/core` 不再公开导出 `KkvService`、`ConfigService`。
- 公开导出 `PersistentState`、`PersistentPreferences`（命名以 SPEC 为准）及对应工厂方法。
- v1 **状态**仅四指针：`currentProjectId`、`currentSessionId`、`currentProviderId`、`currentModelId`。
- v1 **配置**仅 `session-fs.versionCheck`（默认 `true`）。
- CLI：移除 `nm config`、`nm kkv`；新增 `nm preferences`；`project/session/provider/model use` 等行为与现网一致。
- 数据写入 `novel.db` 内新 KKV module（**不**读 `global-config`、**不**读 `config.json`）；**不**自动迁移旧 `global-config` 行。
- core + cli 测试全绿。

**后续迭代（不在本 PRD 验收）**：RN App、Electron 接入两端口；三端共享同一 `novel.db` 的联调验收。

## 用户与场景

**用户**：使用 `nm` 的开发者（本迭代）；未来含 App/Electron 用户。

**场景（本迭代）**：

1. `project use` / `session use` 后省略 `--project` / `--session`。
2. `nm preferences set session-fs.versionCheck false` 后，`session vfs write` 在版本不匹配时不报错。
3. 升级后重新 `use` 即可恢复工作区指针（不依赖旧 `config.json` 或 `global-config`）。

## 范围

### 包含范围

- core：`PersistentState`、`PersistentPreferences`；内部 KKV；module 为 `nm-workspace-state` / `nm-preferences`（见 SPEC）。
- cli：runtime、scope 解析、各 `use`/`delete` 命令、`nm preferences`；删除 `config-cmd`、`kkv` 路由。
- 文档：`monorepo.md`、`persist.md` 等去掉 `config.json` 误导说明。
- 不自动迁移 `global-config`；用户可手动删除遗留 `.novel-master/config.json`（**应用不再使用**）。

### 不包含范围

- **本迭代不修改** `apps/mobile`、`apps/electron`。
- core 不管理各端 UI/内存状态。
- 不把 `config.json`、RN AsyncStorage 等作为 v1 一等存储。
- `global-config` / `config.json` 自动迁移工具。
- 项目级/session 级配置覆盖、审计、导入导出、schema 框架。
- 技术细节见 `spec.md`。

## 核心需求

1. **语义拆分**：状态（工作区指针）与配置（行为偏好）API 分离；禁止单一 Config 桶。
2. **隐藏 KKV**：不作为稳定公开 API；仅通过两端口访问。
3. **薄接口**：v1 状态为四指针显式 get/set/reset；配置 v1 仅 versionCheck（+ `list` 供排障，见 SPEC）。
4. **CLI 适配**：替代全部 `ConfigService` 调用；移除 `nm config`；用 `nm preferences` 管理偏好。
5. **存储位置**：指针与偏好均在 **`novel.db`**；**`config.json` 不再使用**（遗留文件无影响，可删）。
6. **升级**：不读 `global-config`；升级后需重新 `use` / 设置 preferences。
7. **多客户端**：core API 按多客户端设计；**本迭代只验收 CLI**。

## 验收标准

### 公开 API（core）

- [ ] 公开导出无 `KkvService`、`ConfigService` 及其工厂。
- [ ] 公开导出 `PersistentState`、`PersistentPreferences` 及工厂。

### 持久化状态（CLI）

- [ ] 空库下 `project create` 后，省略 `--project` 可解析到正确 project Id。
- [ ] `project use` 切换 project 后，`currentSessionId` 已清除。
- [ ] `provider` / `model` 的 `use` 与 `delete` 对指针的清理与现网一致。

### 持久化配置（CLI）

- [ ] 未设置时 `session-fs.versionCheck` 表现为默认 `true`。
- [ ] `nm preferences set session-fs.versionCheck false` 后，`session vfs write` 版本不匹配时不报冲突。
- [ ] 重启 CLI 进程后偏好仍生效。

### CLI 破坏性变更

- [ ] `nm config …` 返回可判定错误。
- [ ] `nm kkv …` 不再作为用户命令（删除路由）。
- [ ] 用户文档不再引导 `config.json` / `nm config`。

### 升级与遗留文件

- [ ] 库内仅有 `global-config` 行、未重新 `use` 时，行为等同未设置指针，并提示 `use` 或 `--project`。
- [ ] 重新 `use` 后省略 flag 行为正确。
- [ ] **Given** 磁盘存在旧 `.novel-master/config.json`，**When** 仅运行新 CLI，**Then** CLI **不读取**该文件（可选手动删除文件，非必须）。

### 本迭代不验收

- [ ] RN App / Electron 接入。
- [ ] 三端共享同一 `novel.db` 联调（留给后续 PRD）。
- [ ] 自动迁移 `global-config`。
- [ ] core 管理 UI 状态。

## 约束与依赖

- 依赖现有 `novel.db` 与 chat-project-vfs；业务表结构不变（若有调整仅在 SPEC）。
- 取代 `global-config-system` 方向；旧迭代文档标注 superseded。
- 实现以 `spec.md` 为准。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| 遗留 config.json | 用户可能误以为仍生效；文档与 CHANGELOG 说明「已废弃，可删」。 |
| global-config 不迁移 | 升级后需重新 `use`。 |
| PRD 与排期 | 三端同发已调整为 **先 CLI**；App/Electron 另开迭代。 |
| v1 key 冻结 | 扩 key 须改 PRD。 |
