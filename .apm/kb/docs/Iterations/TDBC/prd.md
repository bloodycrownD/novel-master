# TDBC PRD

## 背景

Novel Master 需要在 **React Native** 与 **Node** 环境下访问 SQLite，但底层库差异大（RN 侧多为异步 API，Node 侧常见 `better-sqlite3` 为同步）。已落地的 `SqlTemplateParser` 可将动态 SQL 转为 `{ sql, parameters }`，尚缺统一的**数据库访问协议**屏蔽驱动差异。

TDBC（TypeScript Database Connectivity）定位为类似 JDBC 的**纯通用**、**异步优先**协议：定义连接、执行、查询、事务、批量等能力，由可插拔 Driver 对接具体实现。本期与 **RN Driver**、**better-sqlite3 Driver** 一起设计与验收，而非先做协议再补 Driver。

## 目标（含成功指标）

| 目标 | 说明 |
|------|------|
| 跨平台统一 API | 业务与数据层仅依赖 TDBC 异步接口，不直接依赖 RN SQLite 或 better-sqlite3 |
| 双 Driver 落地 | 同期交付 Node（better-sqlite3）与 RN（常用 SQLite 封装）两个官方 Driver |
| 与模板解析协作 | 通过可选 helper 衔接 `SqlTemplateParser`，协议核心保持解耦 |
| 可验证 | **成功指标**：协议一致性（conformance）测试套件，**两个 Driver 均通过** |

## 用户与场景

| 角色 | 场景 |
|------|------|
| 库/业务开发者 | 在 RN App 或 Node 脚本中 `open` 连接，执行 CRUD、事务、批量写入 |
| 维护者 | 新增 Driver 时对照 conformance 测试，保证行为一致 |
| 本仓库贡献者 | 在 monorepo 中扩展 `@novel-master/core` 协议包与独立 driver 包 |

典型流程：`open` → `execute` / `query` / `batch` → 可选 `transaction` → `close`；若使用动态 SQL，则先 `SqlTemplateParser.parse`，再 `execute(sql, parameters)`（或可选 helper）。

## 范围

### 包含范围

- **TDBC 协议（异步 only）**
  - `Connection`：`open` / `close`
  - `execute`：写操作或通用执行，返回影响行数等元信息
  - `query`：读操作，返回**全量**行集合（数组）
  - `batch`：批量执行（同一 SQL 多组参数或等价语义，具体签名由 SPEC 定）
  - `transaction`：回调式事务（`begin` → `commit` / `rollback`）
  - 统一错误类型（可区分驱动来源、SQLite 错误码等）
  - 参数绑定 **canonical**：`?` + 有序 `parameters[]`（与各 Driver 及 `SqlTemplateParser` 默认占位一致）
- **包结构**
  - `@novel-master/core`：`infra/tdbc` 协议接口、类型、错误、工厂/registry（无原生依赖）
  - 独立包：`@novel-master/tdbc-driver-better-sqlite3`（Node）
  - 独立包：`@novel-master/tdbc-driver-rn`（RN，对接**一种**社区常用 SQLite 实现；实现阶段在 `expo-sqlite` 与 `react-native-quick-sqlite` 中择一，PRD 不锁定到单一品牌）
- **可选集成**
  - core 内**可选** helper（非协议核心）：例如 `executeTemplate(connection, template, ctx)`，内部调用已有 `SqlTemplateParser`
- **测试**
  - 协议 conformance 测试套件，两个 Driver 作为实现必过项

### 不包含范围

- 连接池
- ORM、迁移框架、schema 自省（DatabaseMetaData）
- SAVEPOINT / 嵌套事务
- PostgreSQL、MySQL 等非 SQLite 数据库
- CLI 命令暴露
- AsyncStorage、RNFS 等非 SQL 存储
- 同步 API（Node 同步驱动在 Driver 内部适配为 Promise，不另开同步协议）
- callback 风格 API

## 核心需求（7 条）

1. **协议定义**：在 `packages/core` 的 `infra/tdbc` 定义异步 `Connection` 及关联类型，零运行时第三方依赖。
2. **Driver 注册**：通过 URL 或显式 driver 名创建连接（如 `tdbc:sqlite:...` 或工厂 API），未知 driver 明确报错。
3. **执行语义**：`execute` / `query` / `batch` 行为在两个 Driver 上一致；空参数、null 绑定规则由 conformance 锁定。
4. **事务**：`transaction(fn)` 在 fn 抛错或返回 rejected Promise 时回滚；成功则提交。
5. **RN Driver**：基于选定的常用 RN SQLite 库实现，全异步，可在模拟器/真机或等价自动化环境中验证（具体环境由 SPEC 定）。
6. **Node Driver**：基于 `better-sqlite3` 实现，对外仍为 Promise API。
7. **Conformance**：共享测试用例覆盖连接生命周期、CRUD、事务、batch、错误传播；两 Driver 均须通过方可视为首期完成。

## 验收标准

### 协议与连接

- **Given** 合法 SQLite 连接配置  
  **When** `open`  
  **Then** 返回可用 `Connection`，`close` 后不可再执行语句。

- **Given** 未注册的 driver 标识  
  **When** `open`  
  **Then** 抛出可区分错误，不创建半开连接。

### 执行与查询

- **Given** `INSERT` / `UPDATE` / `DELETE` 与 `?` 占位参数  
  **When** `execute`  
  **Then** 两 Driver 返回一致的元信息语义（如 `changes` / `lastInsertRowid`，字段名由 SPEC 统一）。

- **Given** `SELECT`  
  **When** `query`  
  **Then** 返回行数组，列名与 SQLite 结果一致；BLOB 等类型映射两 Driver 一致。

- **Given** `SqlTemplateParser` 输出的 `{ sql, parameters }`  
  **When** `execute(sql, parameters)`  
  **Then** 无需改写法即可在两 Driver 上执行成功。

### 事务

- **Given** `transaction` 内多次 `execute` 后正常返回  
  **When** 事务结束  
  **Then** 数据持久化可见。

- **Given** `transaction` 内任一步抛错  
  **When** 事务结束  
  **Then** 已做变更回滚，连接仍可用。

### 批量

- **Given** 同一 SQL 与多组参数  
  **When** `batch`  
  **Then** 两 Driver 均完成全部组或整体失败（行为由 SPEC/conformance 锁定，禁止一半成功一半静默失败）。

### Conformance 门禁

- **Given** 协议 conformance 测试套件  
  **When** 分别对接 better-sqlite3 Driver 与 RN Driver 运行  
  **Then** **全部通过**（允许 SKIP 的用例须在 SPEC 中列出理由，且不影响核心 CRUD/事务/batch 条目）。

### 可选 helper

- **Given** 使用 core 提供的 template helper（若实现）  
  **When** 传入模板与 params  
  **Then** 等价于手动 `parse` + `execute` / `query` 的结果。

## 约束与依赖

- 依赖已有 `SqlTemplateParser` 的 `?` + 有序参数约定；不修改其首期行为。
- RN Driver 依赖具体 SQLite 原生模块（选型在 SPEC 阶段确定一种常用实现）。
- Node Driver 依赖 `better-sqlite3`（仅 Node 包，不进入 core 运行时依赖）。
- Monorepo：协议在 core，Driver 为独立 workspace 包，避免 core 引入 native 绑定。

## 非功能需求（业务/体验）

- API 命名与错误信息对 TypeScript 友好，公共接口具备类型定义。
- 文档说明 `${}` 与动态 SQL 注入风险仍由 `SqlTemplateParser` 侧负责；TDBC 只执行已拼好的 SQL 与绑定参数。
- RN 上避免长时间阻塞 JS 线程（通过异步 Driver 与合理 batch 粒度）。

## 风险与待确认项

| 项 | 说明 |
|----|------|
| RN 库选型 | PRD 要求「常用一种」，SPEC 需在 `expo-sqlite` / `react-native-quick-sqlite` 等中择一并记录限制 |
| RN CI | 真机/模拟器测试成本；conformance 是否允许 RN 子集在 CI 用 mock（SPEC 决策） |
| 同步引擎包装 | better-sqlite3 同步调用需在 Driver 内序列化，避免并发事务冲突 |
| 类型映射 | `INTEGER`/`REAL`/`TEXT`/`BLOB` 与 JS 类型在两端的差异须在 conformance 中断言 |
| batch 语义 | 与 SQLite `run`/`exec` 批量接口对齐方式待 SPEC 细化 |

---

**文档路径**：`.apm/kb/docs/Iterations/TDBC/prd.md`  
**范围边界**：本文档仅描述产品需求与验收标准，不包含接口签名、类图、任务拆分；与 `SqlTemplateParser` 的 SPEC 分离。
