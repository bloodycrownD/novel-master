# VFS 与数据分层 PRD

## 背景

Novel Master 已有 **TDBC**（SQLite 访问）、**SqlTemplateParser**（动态 SQL）。业务需要统一的**虚拟文件系统（VFS）**管理路径化内容（章节、资源等），并配套 **CLI** 供本地调试与脚本化操作。

用户与 AI 协作编辑时，存在「先读后隔很久再写」的**协作冲突**，需版本校验；目录需支持**递归列举**与**递归删除**。首期以 **Node + better-sqlite3** 交付；RN 复用 core 分层，CLI 与 repositories 不暴露给应用外。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 分层清晰 | core 内 **model / repositories（内部）/ bootstrap / service（对外）**，service 为稳定 API |
| VFS 能力 | 路径化内容的 list / read / write / replace / glob / grep / delete |
| 协作安全 | 写操作默认 **expectedVersion** 校验，支持按次关闭 `versionCheck` |
| CLI 可用 | `novel-master vfs …` 子命令调用 core service，注册 **better-sqlite3** driver |
| 可验证 | **成功指标**：CLI 各子命令 E2E 场景通过 + core 单测覆盖 service 与 repository 行为 |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 开发者 / 运维 | CLI 浏览、读写、按模式查找、批量替换、删除目录树 |
| 未来 RN / Agent | 仅依赖 **service** 接口，不直接访问 repository；冲突时由上层重读 |
| 维护者 | bootstrap 初始化表结构；升级预留 external 存储字段 |

典型流程：CLI 启动 → 注册 driver → bootstrap 建表 → `VfsService.list/read/...` → 输出结果。

## 范围

### 包含范围

**core（`packages/core/src`）**

- **model**：VFS 实体（如路径条目：path、content、version、mtime、预留 storage/external 字段等）
- **repositories**（**不对外导出**）：基于 TDBC 的 SQLite 实现；简单能力由 **service 透传** repository；repository 层可预留「外部数据源」扩展点（防腐/DDD），首期以实现 SQLite 为主，**不暴露** repository 类型给包外
- **bootstrap**：负责 **表初始化**（DDL）、可选种子数据；与 TDBC `open` 配合，由应用/CLI 在启动时调用（**不**在 bootstrap 内注册 driver）
- **service**：对外稳定 API（list / read / write / replace / glob / grep / delete 等），封装 version、错误语义；**唯一**建议业务方使用的数据入口

**存储（首期）**

- **SQLite 内联**：路径 + 正文 + version 等同库；表结构 **预留** external 存储字段，**暂不实现**外置文件读写

**版本与 replace**

- `read` 返回内容与 **version**
- `write`：新建或覆盖；默认 **version 校验**（`expectedVersion` + 可选 `versionCheck: false`）
- **无 `update` 子命令**；CLI 提供 **`replace`**：默认替换**首次**出现的 `oldString`；`--all` 替换全部；若 `oldString` 不存在则**失败报错**
- replace 走 service，内部 read + 替换 + 带 version 的写回

**list / delete 递归**

- **list**：支持递归；可设置 **最大递归层数**（如 `--recursive` + `--depth <n>`，具体参数名由 SPEC 定，PRD 要求能力存在）
- **delete**：支持删除路径；**递归删除**子路径（如 `--recursive`），行为须在验收用例中明确（删目录树、不存在时报错等）

**glob / grep**

- **glob**：按路径模式匹配（如 `chapters/**/*.md`）
- **grep**：按内容搜索（字符串/正则范围由 SPEC 细化）

**CLI（`apps/cli`）**

- 子命令：`nm vfs list | read | write | replace | glob | grep | delete`（与现有 `novel-master` 二进制集成）
- 使用 **@novel-master/tdbc-driver-better-sqlite3** 注册 driver 并 `open`
- 调用 **core service**，不直接写 SQL

### 不包含范围

- RN App UI、RN driver 在 CLI 中的使用（core 结构可预留 RN 复用）
- 对外暴露 **repositories** 包级 API
- 连接池
- 首期 **external** 文件 payload 读写（仅表字段预留）
- Agent 编排、proposal 流程、合并 UI（归属上层；VFS 仅提供 version 冲突错误）
- 真实 OS 文件系统作为 VFS 后端（首期不做）
- 云同步、多设备冲突合并策略

## 核心需求（7 条）

1. **bootstrap**：给定已打开的 TDBC 连接，幂等执行 VFS 表 DDL；重复调用不破坏已有数据（`IF NOT EXISTS` 或等价策略）。
2. **model + repository**：实体与 SQLite 访问分离；repository **仅在 core 内部**使用；写路径使用 `UPDATE … WHERE path AND version` 语义，`changes=0` 时区分不存在与版本冲突（PRD 要求可判定错误，具体码由 SPEC）。
3. **service**：对外提供 list（含递归与 depth）、read、write、replace、glob、grep、delete（含递归）；默认开启 version 校验，支持关闭。
4. **replace 语义**：首次匹配替换；`--all` 全部替换；无匹配则失败，不静默成功。
5. **CLI**：实现上述子命令及参数（含 list 递归层数、delete 递归）；启动流程 register driver → open → bootstrap → 调用 service。
6. **依赖关系**：复用现有 TDBC、SqlTemplateParser（若 repository 使用动态 SQL）；**不**修改 TDBC 协议行为。
7. **测试**：core 单测（service/repository/bootstrap）；CLI E2E 覆盖各子命令主路径与 replace/递归/版本冲突关键分支。

## 验收标准

### bootstrap

- **Given** 空库、合法 TDBC 连接  
  **When** 调用 bootstrap  
  **Then** VFS 表存在，再次调用不报错且结构仍可用。

### read / write / version

- **Given** 路径不存在  
  **When** `write` 创建内容  
  **Then** 可读回，`version` 为 1（或约定初值）。

- **Given** 已有路径 `version=2`  
  **When** `write` 带 `expectedVersion=2`  
  **Then** 成功且 `version` 递增。

- **Given** 已有路径 `version=3`  
  **When** `write` 带 `expectedVersion=2`  
  **Then** 失败（版本冲突），内容仍为 v3 对应正文。

- **Given** `versionCheck=false`  
  **When** `write` 不传或忽略 expectedVersion  
  **Then** 按产品约定覆盖成功（仍递增 version 或保持策略由 SPEC 锁定）。

### replace

- **Given** 内容为 `hello world`  
  **When** `replace` old=`world` new=`there`  
  **Then** 结果为 `hello there`，version 按写规则更新。

- **Given** 同上且 `--all`，内容为 `a X b X`  
  **When** replace old=`X` new=`Y`  
  **Then** 全部为 `Y`。

- **Given** 内容不含 `oldString`  
  **When** replace  
  **Then** 失败，不产生部分写入。

### list

- **Given** 树形路径 `/a`, `/a/b`, `/a/b/c`  
  **When** `list /a` 非递归  
  **Then** 仅直接子项（行为用例锁定）。

- **When** `list` 递归且 `depth=2`  
  **Then** 深度不超过 2 的条目均出现，更深层不出现。

### delete

- **Given** 存在子路径树  
  **When** `delete /a` 无递归且 `/a` 非空  
  **Then** 失败或拒绝（策略用例锁定，须一致）。

- **When** `delete /a --recursive`  
  **Then** `/a` 及子路径均不可再 read。

### glob / grep

- **Given** 多个路径与内容  
  **When** `glob('**/*.md')`  
  **Then** 返回匹配路径列表。

- **When** `grep('pattern')`  
  **Then** 返回含匹配的路径（及行信息若 SPEC 定义）。

### CLI E2E

- **Given** 已安装 `novel-master` 且配置本地 db 路径  
  **When** 依次执行 `vfs write`、`vfs read`、`vfs list -r`、`vfs replace`、`vfs grep`、`vfs glob`、`vfs delete -r`  
  **Then** 退出码 0，输出符合预期；版本冲突时非 0 且错误信息可辨。

### 封装边界

- **Given** 包外消费者  
  **When** 查看 `@novel-master/core` 公共导出  
  **Then** **无** repository 类型导出；**有** service（及必要 model/DTO、错误类型）。

## 约束与依赖

- 依赖已合并的 **TDBC**、**tdbc-driver-better-sqlite3**；CLI 负责 driver 注册。
- SQLite 单连接复用即可，**不做**连接池。
- 与既有 `infra/tdbc`、`infra/sql-template` 并存；目录布局在 SPEC 中细化（`src/model` 等）。

## 非功能需求（业务/体验）

- CLI 错误信息对人类可读（路径、冲突、replace 未找到等）。
- 文本内容默认 UTF-8。
- 递归 delete 须在文档/帮助中提示不可恢复。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| list 非递归默认 | 默认 depth=1 还是仅当前层，SPEC 用测试锁定 |
| delete 非空目录 | 非递归是否禁止删除有子节点的路径 |
| replace 与 version | replace 是否始终基于 read 时的 version 做 OCC |
| grep 性能 | 大库全表扫描可接受；后期可加 FTS |

---

**文档路径**：`.apm/kb/docs/Iterations/VFS/prd.md`  
**范围边界**：本文档仅描述产品需求与验收标准，不包含类图、表 DDL、CLI 参数逐字符定义、任务拆分（见后续 SPEC）。
