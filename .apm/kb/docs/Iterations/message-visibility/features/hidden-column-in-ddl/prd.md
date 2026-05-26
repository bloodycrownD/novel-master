# chat_message.hidden 写入 DDL PRD

## 背景与变更动机

Message 可见性（`hidden`）功能已实现：模型、Repository、Service、CLI、Prompt 过滤与单元测试均就绪。但数据库层存在**双轨定义**：

- `chat-schema.ts` 的 `CREATE TABLE chat_message` **未声明** `hidden` 列；
- `novel-master-bootstrap.ts` 通过 `PRAGMA table_info` + `ALTER TABLE` 在运行时补列。

这带来两类问题：

1. **可读性与维护**：阅读 DDL 会误以为表无 `hidden`，与运行时真实结构不一致。
2. **技术债**：迁移逻辑与 SPEC 中「在 `CHAT_SCHEMA_STATEMENTS` 追加 ALTER」的折中方案并存，增加认知负担。

本次为小修正：将 `hidden` **直接写入** `CREATE TABLE`，并**删除** bootstrap 中的兼容迁移代码，使 schema 文件成为唯一真相。

## 范围变更说明（相对原需求）

| 维度 | 原 message-visibility | 本次变更 |
|------|----------------------|----------|
| 列定义位置 | CREATE TABLE 无 `hidden`；bootstrap 迁移补列 | `CREATE TABLE` 含 `hidden INTEGER NOT NULL DEFAULT 0` |
| 旧库兼容 | `bootstrapNovelMaster` 自动为无列库执行 `ALTER TABLE` | **不再自动迁移**；无 `hidden` 列的旧库需用户自行 `ALTER` 或重建库 |
| 业务行为 | hide/show、prompt 过滤、fork/copy 保留状态 | **不变** |
| API / CLI | 已有接口与命令 | **不变**（仅验证与 DDL 一致） |

**明确不包含**：

- 新的 hide/show 能力或 Prompt 过滤策略变更；
- 旧库批量迁移工具或版本检测 CLI；
- UI 可见性相关能力。

## 影响模块与接口

### 必改

| 模块 | 文件 | 变更 |
|------|------|------|
| Chat DDL | `packages/core/src/bootstrap/chat/chat-schema.ts` | `chat_message` 表增加 `hidden INTEGER NOT NULL DEFAULT 0` |
| Bootstrap | `packages/core/src/bootstrap/novel-master-bootstrap.ts` | 删除 `migrateChatMessageHidden` 及其调用 |

### 验证不变（全栈一致性）

| 层 | 文件 | 说明 |
|----|------|------|
| 模型 | `domain/chat/model/message.ts` | `ChatMessage.hidden` 已存在，无需改 |
| Repository | `sqlite-message.repository.ts` | SELECT/INSERT/UPDATE 已含 `hidden`，无需改 |
| Service | `message.service.ts` | hide/show/hideRange/showRange 已存在，无需改 |
| CLI | `apps/cli/src/message/commands.ts`、`prompt/commands.ts` | 行为不变，回归验证 |
| 测试 | `packages/core/test/chat/message-visibility.test.ts` | 应继续通过（测试库经 bootstrap 新建） |

### 文档（实现阶段同步，非本 PRD 阻塞项）

- `.apm/kb/docs/Iterations/message-visibility/spec.md`：将「ALTER 迁移」改为「DDL 内联列」；回滚/风险章节去掉 `migrateChatMessageHidden` 描述。
- 可选：在迭代主 `prd.md` 或本 feature PRD 脚注说明旧库处理方式。

### 对外接口

无新增、无删除、无签名变更。

## 验收标准

- [ ] `chat-schema.ts` 中 `CREATE TABLE chat_message` 包含 `hidden INTEGER NOT NULL DEFAULT 0`。
- [ ] `novel-master-bootstrap.ts` 中不存在 `migrateChatMessageHidden`、`PRAGMA table_info(chat_message)` 及针对 `hidden` 的 `ALTER TABLE`。
- [ ] 对**新建/空库**执行 `bootstrapNovelMaster` 后，`PRAGMA table_info(chat_message)` 可查到 `hidden` 列，默认值为 `0`。
- [ ] `packages/core` 下 `message-visibility` 相关单元测试全部通过。
- [ ] 手动抽查：`nm message hide/show`、`nm message list` 的 `[H]`、`nm prompt render` 过滤行为与变更前一致。
- [ ] **不承诺**：对已存在且 `chat_message` 无 `hidden` 列的旧 `.db` 文件，bootstrap 不再自动修复；文档中已说明需重建或手动 `ALTER TABLE chat_message ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`。

## 测试用例

### 单元测试（自动化）

1. **现有套件回归**  
   - 命令：`npm test`（`packages/core`，或项目约定的 core 测试入口）  
   - 文件：`packages/core/test/chat/message-visibility.test.ts`  
   - 期望：全部通过（覆盖单条 hide/show、seq 范围、fork/copy 保留 hidden）。

2. **DDL 结构断言（可选新增）**  
   - Given：内存或临时库执行 `bootstrapNovelMaster`  
   - When：`PRAGMA table_info(chat_message)`  
   - Then：存在名为 `hidden` 的列，类型为 INTEGER，`notnull=1`，`dflt_value=0`。

### 手工 / CLI（抽样）

3. **新建库 hide → list**  
   - 新建 project/session，append 2 条消息，`nm message hide --message <id>`，`nm message list` 对应行含 `[H]`。

4. **prompt 过滤**  
   - 隐藏部分消息后 `nm prompt render`，输出不含被隐藏消息内容。

### 负向（旧库，仅文档约定）

5. **无 hidden 列的旧库**  
   - Given：人为构造或保留的无 `hidden` 列的 `chat_message` 表  
   - When：仅执行 bootstrap（不手动 ALTER）  
   - Then：**不保证**可用；用户需按文档手动迁移或重建。本用例不作为 CI 必过项。
